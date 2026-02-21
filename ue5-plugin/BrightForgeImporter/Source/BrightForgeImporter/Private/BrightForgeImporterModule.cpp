/** BrightForge Importer Module implementation. */

#include "BrightForgeImporterModule.h"
#include "SBrightForgePanel.h"
#include "Framework/Docking/TabManager.h"
#include "ToolMenus.h"
#include "Widgets/Docking/SDockTab.h"

#define LOCTEXT_NAMESPACE "FBrightForgeImporterModule"

DEFINE_LOG_CATEGORY_STATIC(LogBrightForge, Log, All);

static const FName BrightForgeTabName("BrightForgeImporter");

void FBrightForgeImporterModule::StartupModule()
{
	UE_LOG(LogBrightForge, Log, TEXT("BrightForge Importer module starting up"));

	// Register the tab spawner
	FGlobalTabmanager::Get()->RegisterNomadTabSpawner(
		BrightForgeTabName,
		FOnSpawnTab::CreateRaw(this, &FBrightForgeImporterModule::OnSpawnPluginTab))
		.SetDisplayName(LOCTEXT("TabTitle", "BrightForge Importer"))
		.SetMenuType(ETabSpawnerMenuType::Hidden);

	RegisterMenuExtension();
}

void FBrightForgeImporterModule::ShutdownModule()
{
	UE_LOG(LogBrightForge, Log, TEXT("BrightForge Importer module shutting down"));

	UToolMenus::UnRegisterStartupCallback(this);
	UToolMenus::UnregisterOwner(this);

	FGlobalTabmanager::Get()->UnregisterNomadTabSpawner(BrightForgeTabName);
}

void FBrightForgeImporterModule::RegisterMenuExtension()
{
	UToolMenus::RegisterStartupCallback(FSimpleMulticastDelegate::FDelegate::CreateLambda([this]()
	{
		UToolMenu* ToolbarMenu = UToolMenus::Get()->ExtendMenu(
			"LevelEditor.LevelEditorToolBar.PlayToolBar");

		FToolMenuSection& Section = ToolbarMenu->FindOrAddSection("BrightForge");
		Section.AddEntry(FToolMenuEntry::InitToolBarButton(
			"OpenBrightForge",
			FUIAction(FExecuteAction::CreateLambda([]()
			{
				FGlobalTabmanager::Get()->TryInvokeTab(BrightForgeTabName);
			})),
			LOCTEXT("ToolbarButtonLabel", "BrightForge"),
			LOCTEXT("ToolbarButtonTooltip", "Open BrightForge Importer panel"),
			FSlateIcon(FAppStyle::GetAppStyleSetName(), "LevelEditor.OpenContentBrowser")
		));
	}));
}

TSharedRef<SDockTab> FBrightForgeImporterModule::OnSpawnPluginTab(const FSpawnTabArgs& SpawnTabArgs)
{
	return SNew(SDockTab)
		.TabRole(ETabRole::NomadTab)
		[
			SNew(SBrightForgePanel)
		];
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FBrightForgeImporterModule, BrightForgeImporter)
