/**
 * -------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation.  All Rights Reserved.  Licensed under the MIT License.
 * See License in the project root for license information.
 * -------------------------------------------------------------------------------------------
 */

/**
 * @module RetryHandler
 */

import { MiddlewareContext } from "./middlewareContext";
import { HttpMethod } from "@microsoft/kiota-abstractions";
import { Middleware } from "./middleware";
import { getRequestHeader, setRequestHeader } from "./middlewareUtil";
import { RetryHandlerOptions } from "./options/retryHandlerOptions";
import { MiddlewareControl } from "./MiddlewareControl";
import {FetchResponse, FetchRequestInit, FetchRequestInfo} from "../utils/fetchDefinitions"

/**
 * @class
 * @implements Middleware
 * Class for RetryHandler
 */
export class RetryHandler implements Middleware {
	/**
	 * @private
	 * @static
	 * A list of status codes that needs to be retried
	 */
	private static RETRY_STATUS_CODES: number[] = [
		429, // Too many requests
		503, // Service unavailable
		504, // Gateway timeout
	];

	/**
	 * @private
	 * @static
	 * A member holding the name of retry attempt header
	 */
	private static RETRY_ATTEMPT_HEADER = "Retry-Attempt";

	/**
	 * @private
	 * @static
	 * A member holding the name of retry after header
	 */
	private static RETRY_AFTER_HEADER = "Retry-After";

	/**
	 * @private
	 * The next middleware in the middleware chain
	 */
	next: Middleware;

	/**
	 * @private
	 * A member holding the retry handler options
	 */
	private options: RetryHandlerOptions;

	/**
	 * @public
	 * @constructor
	 * To create an instance of RetryHandler
	 * @param {RetryHandlerOptions} [options = new RetryHandlerOptions()] - The retry handler options value
	 * @returns An instance of RetryHandler
	 */
	public constructor(options: RetryHandlerOptions = new RetryHandlerOptions()) {
		this.options = options;
	}

	/**
	 *
	 * @private
	 * To check whether the response has the retry status code
	 * @param {Response} response - The response object
	 * @returns Whether the response has retry status code or not
	 */
	private isRetry(response: FetchResponse): boolean {
		return RetryHandler.RETRY_STATUS_CODES.indexOf(response.status) !== -1;
	}

	/**
	 * @private
	 * To check whether the payload is buffered or not
	 * @param {RequestInfo} request - The url string or the request object value
	 * @param {RequestInit} options - The options of a request
	 * @returns Whether the payload is buffered or not
	 */
	private isBuffered(request: FetchRequestInfo, options: FetchRequestInit | undefined): boolean {
		const method = options
		const isPutPatchOrPost: boolean = method === HttpMethod.PUT || method === HttpMethod.PATCH || method === HttpMethod.POST;
		if (isPutPatchOrPost) {
			const isStream = getRequestHeader(request, options, "Content-Type") === "application/octet-stream";
			if (isStream) {
				return false;
			}
		}
		return true;
	}

	/**
	 * @private
	 * To get the delay for a retry
	 * @param {Response} response - The response object
	 * @param {number} retryAttempts - The current attempt count
	 * @param {number} delay - The delay value in seconds
	 * @returns A delay for a retry
	 */
	private getDelay(response: FetchResponse, retryAttempts: number, delay: number): number {
		const getRandomness = () => Number(Math.random().toFixed(3));
		const retryAfter = response.headers !== undefined ? response.headers.get(RetryHandler.RETRY_AFTER_HEADER) : null;
		let newDelay: number;
		if (retryAfter !== null) {

            // Retry-After: <http-date>
			if (Number.isNaN(Number(retryAfter))) {
				newDelay = Math.round((new Date(retryAfter).getTime() - Date.now()) / 1000);
			} else {
            // Retry-After: <delay-seconds>
				newDelay = Number(retryAfter);
			}
		} else {
			// Adding randomness to avoid retrying at a same
			newDelay = retryAttempts >= 2 ? this.getExponentialBackOffTime(retryAttempts) + delay + getRandomness() : delay + getRandomness();
		}
		return Math.min(newDelay, this.options.getMaxDelay() + getRandomness());
	}

	/**
	 * @private
	 * To get an exponential back off value
	 * @param {number} attempts - The current attempt count
	 * @returns An exponential back off value
	 */
	private getExponentialBackOffTime(attempts: number): number {
		return Math.round((1 / 2) * (2 ** attempts - 1));
	}

	/**
	 * @private
	 * @async
	 * To add delay for the execution
	 * @param {number} delaySeconds - The delay value in seconds
	 * @returns Nothing
	 */
	private async sleep(delaySeconds: number): Promise<void> {
		const delayMilliseconds = delaySeconds * 1000;
		return new Promise((resolve) => setTimeout(resolve, delayMilliseconds)); // browser or node
	}

	private getOptions(context: MiddlewareContext): RetryHandlerOptions {
		let options: RetryHandlerOptions;
		if (context.middlewareControl instanceof MiddlewareControl) {
			options = context.middlewareControl.getMiddlewareOptions(RetryHandlerOptions) as RetryHandlerOptions;
		}
		if (typeof options === "undefined") {
			options = Object.assign(new RetryHandlerOptions(), this.options);
		}
		return options;
	}

	/**
	 * @private
	 * @async
	 * To execute the middleware with retries
	 * @param {Context} context - The context object
	 * @param {number} retryAttempts - The current attempt count
	 * @param {RetryHandlerOptions} options - The retry middleware options instance
	 * @returns A Promise that resolves to nothing
	 */
	private async executeWithRetry(context: MiddlewareContext, retryAttempts: number, options: RetryHandlerOptions): Promise<void> {
		await this.next.execute(context);
		if (retryAttempts < options.maxRetries && this.isRetry(context.response) && this.isBuffered(context.request, context.options) && options.shouldRetry(options.delay, retryAttempts, context.request, context.options, context.response)) {
			++retryAttempts;
			setRequestHeader(context.request, context.options, RetryHandler.RETRY_ATTEMPT_HEADER, retryAttempts.toString());
			const delay = this.getDelay(context.response, retryAttempts, options.delay);
			await this.sleep(delay);
			return await this.executeWithRetry(context, retryAttempts, options);
		} else {
			return;
		}
	}

	/**
	 * @public
	 * @async
	 * To execute the current middleware
	 * @param {Context} context - The context object of the request
	 * @returns A Promise that resolves to nothing
	 */
	public async execute(context: MiddlewareContext): Promise<void> {
		const retryAttempts = 0;
		const options: RetryHandlerOptions = this.getOptions(context);
		return await this.executeWithRetry(context, retryAttempts, options);
	}
}
