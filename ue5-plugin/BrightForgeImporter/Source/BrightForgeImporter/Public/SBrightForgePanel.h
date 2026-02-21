/** BrightForge Panel - Slate widget for browsing and importing Forge3D assets. */
#pragma once

#include "CoreMinimal.h"
#include "Widgets/SCompoundWidget.h"

struct FBrightForgeAssetEntry
{
	FString Id;
	FString Name;
	FString Type;
	FString CreatedAt;
};

class SBrightForgePanel : public SCompoundWidget
{
public:
	SLATE_BEGIN_ARGS(SBrightForgePanel) {}
	SLATE_END_ARGS()

	void Construct(const FArguments& InArgs);

private:
	/** UI state */
	FString ServerUrl = TEXT("http://localhost:3847");
	bool bIsConnected = false;
	FString StatusMessage = TEXT("Not connected");

	TArray<TSharedPtr<FString>> ProjectNames;
	TArray<FString> ProjectIds;
	TSharedPtr<FString> SelectedProject;
	int32 SelectedProjectIndex = INDEX_NONE;

	TArray<FBrightForgeAssetEntry> Assets;

	FString ImportDestination = TEXT("/Game/BrightForge/Generated");

	/** UI callbacks */
	FReply OnConnectClicked();
	FReply OnRefreshClicked();
	FReply OnImportClicked();
	FReply OnImportAllClicked();

	void OnProjectSelected(TSharedPtr<FString> NewValue, ESelectInfo::Type SelectInfo);

	/** Helpers */
	void FetchProjects();
	void FetchAssets(const FString& ProjectId);
	void ImportAsset(const FString& AssetId, const FString& AssetName);

	/** Widget refs for dynamic updates */
	TSharedPtr<SVerticalBox> AssetListBox;
	TSharedPtr<STextBlock> StatusText;

	void RebuildAssetList();
	void SetStatus(const FString& Message, bool bConnected);
};
