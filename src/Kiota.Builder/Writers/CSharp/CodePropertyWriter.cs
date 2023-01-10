﻿using Kiota.Builder.CodeDOM;
using Kiota.Builder.Extensions;

namespace Kiota.Builder.Writers.CSharp;
public class CodePropertyWriter : BaseElementWriter<CodeProperty, CSharpConventionService>
{
    public CodePropertyWriter(CSharpConventionService conventionService): base(conventionService) { }
    public override void WriteCodeElement(CodeProperty codeElement, LanguageWriter writer)
    {
        var propertyType = conventions.GetTypeString(codeElement.Type, codeElement);
        var isNullableReferenceType = !propertyType.EndsWith("?") 
                                      && codeElement.IsOfKind(CodePropertyKind.Custom,CodePropertyKind.QueryParameter);// Other property types are apropriately constructor initialized
        conventions.WriteShortDescription(codeElement.Documentation.Description, writer);
        if (isNullableReferenceType)
        {
            writer.WriteLine("#if NETSTANDARD2_1_OR_GREATER || NET6_0_OR_GREATER",false);
            WritePropertyInternal(codeElement, writer, $"{propertyType}?");
            writer.WriteLine("#else",false);
        }
        
        WritePropertyInternal(codeElement, writer, propertyType);// Always write the normal way
        
        if (isNullableReferenceType)
            writer.WriteLine("#endif",false);
    }

    private void WritePropertyInternal(CodeProperty codeElement, LanguageWriter writer, string propertyType)
    {
        var parentClass = codeElement.Parent as CodeClass;
        var backingStoreProperty = parentClass.GetBackingStoreProperty();
        var setterAccessModifier = codeElement.ReadOnly && codeElement.Access > AccessModifier.Private ? "private " : string.Empty;
        var simpleBody = $"get; {setterAccessModifier}set;";
        var defaultValue = string.Empty;
        switch(codeElement.Kind) {
            case CodePropertyKind.RequestBuilder:
                writer.WriteLine($"{conventions.GetAccessModifier(codeElement.Access)} {propertyType} {codeElement.Name.ToFirstCharacterUpperCase()} {{ get =>");
                writer.IncreaseIndent();
                conventions.AddRequestBuilderBody(parentClass, propertyType, writer);
                writer.DecreaseIndent();
                writer.WriteLine("}");
                break;
            case CodePropertyKind.AdditionalData when backingStoreProperty != null:
            case CodePropertyKind.Custom when backingStoreProperty != null:
                var backingStoreKey = codeElement.SerializationName ?? codeElement.Name.ToFirstCharacterLowerCase();
                writer.WriteLine($"{conventions.GetAccessModifier(codeElement.Access)} {propertyType} {codeElement.Name.ToFirstCharacterUpperCase()} {{");
                writer.IncreaseIndent();
                writer.WriteLine($"get {{ return {backingStoreProperty.Name.ToFirstCharacterUpperCase()}?.Get<{propertyType}>(\"{backingStoreKey}\"); }}");
                writer.WriteLine($"set {{ {backingStoreProperty.Name.ToFirstCharacterUpperCase()}?.Set(\"{backingStoreKey}\", value); }}");
                writer.DecreaseIndent();
                writer.WriteLine("}");
                break;
            case CodePropertyKind.QueryParameter when codeElement.IsNameEscaped:
                writer.WriteLine($"[QueryParameter(\"{codeElement.SerializationName}\")]");
                goto default;
            case CodePropertyKind.QueryParameters:
                defaultValue = $" = new {propertyType}();";
                goto default;
            default:
                writer.WriteLine($"{conventions.GetAccessModifier(codeElement.Access)} {propertyType} {codeElement.Name.ToFirstCharacterUpperCase()} {{ {simpleBody} }}{defaultValue}");
                break;
        }
    }
}
