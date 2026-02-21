using UnrealBuildTool;

public class BrightForgeImporter : ModuleRules
{
    public BrightForgeImporter(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new string[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "HTTP",
            "Json",
            "JsonUtilities"
        });

        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "Slate",
            "SlateCore",
            "EditorFramework",
            "UnrealEd",
            "ToolMenus",
            "InputCore"
        });
    }
}
