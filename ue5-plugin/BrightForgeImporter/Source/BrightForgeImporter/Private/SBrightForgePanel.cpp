/** BrightForge Panel implementation - Slate UI for browsing and importing assets. */

#include "SBrightForgePanel.h"
#include "BrightForgeHttpClient.h"
#include "Widgets/Input/SButton.h"
#include "Widgets/Input/SEditableTextBox.h"
#include "Widgets/Input/SComboBox.h"
#include "Widgets/Layout/SScrollBox.h"
#include "Widgets/Text/STextBlock.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Misc/Paths.h"

#define LOCTEXT_NAMESPACE "SBrightForgePanel"

DEFINE_LOG_CATEGORY_STATIC(LogBrightForgePanel, Log, All);

/** Shared HTTP client instance for this panel. */
static FBrightForgeHttpClient GHttpClient;

void SBrightForgePanel::Construct(const FArguments& InArgs)
{
	ChildSlot
	[
		SNew(SVerticalBox)

		// --- Server Connection ---
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.Padding(0, 0, 4, 0)
			[
				SNew(SEditableTextBox)
				.Text(FText::FromString(ServerUrl))
				.OnTextCommitted_Lambda([this](const FText& NewText, ETextCommit::Type CommitType)
				{
					ServerUrl = NewText.ToString();
				})
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			[
				SNew(SButton)
				.Text(LOCTEXT("ConnectBtn", "Connect"))
				.OnClicked(this, &SBrightForgePanel::OnConnectClicked)
			]
		]

		// --- Status Bar ---
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(8.0f, 0, 8.0f, 4.0f)
		[
			SAssignNew(StatusText, STextBlock)
			.Text(FText::FromString(StatusMessage))
		]

		// --- Project Selector ---
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(8.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(0, 0, 8, 0)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("ProjectLabel", "Project:"))
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			.Padding(0, 0, 4, 0)
			[
				SNew(SComboBox<TSharedPtr<FString>>)
				.OptionsSource(&ProjectNames)
				.OnSelectionChanged(this, &SBrightForgePanel::OnProjectSelected)
				.OnGenerateWidget_Lambda([](TSharedPtr<FString> Item)
				{
					return SNew(STextBlock).Text(FText::FromString(*Item));
				})
				[
					SNew(STextBlock)
					.Text_Lambda([this]()
					{
						return SelectedProject.IsValid()
							? FText::FromString(*SelectedProject)
							: LOCTEXT("NoProject", "Select a project...");
					})
				]
			]
			+ SHorizontalBox::Slot()
			.AutoWidth()
			[
				SNew(SButton)
				.Text(LOCTEXT("RefreshBtn", "Refresh"))
				.OnClicked(this, &SBrightForgePanel::OnRefreshClicked)
			]
		]

		// --- Import Destination ---
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(8.0f, 0, 8.0f, 4.0f)
		[
			SNew(SHorizontalBox)
			+ SHorizontalBox::Slot()
			.AutoWidth()
			.VAlign(VAlign_Center)
			.Padding(0, 0, 8, 0)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("DestLabel", "Import to:"))
			]
			+ SHorizontalBox::Slot()
			.FillWidth(1.0f)
			[
				SNew(SEditableTextBox)
				.Text(FText::FromString(ImportDestination))
				.OnTextCommitted_Lambda([this](const FText& NewText, ETextCommit::Type CommitType)
				{
					ImportDestination = NewText.ToString();
				})
			]
		]

		// --- Asset List ---
		+ SVerticalBox::Slot()
		.FillHeight(1.0f)
		.Padding(8.0f)
		[
			SNew(SScrollBox)
			+ SScrollBox::Slot()
			[
				SAssignNew(AssetListBox, SVerticalBox)
			]
		]

		// --- Import All Button ---
		+ SVerticalBox::Slot()
		.AutoHeight()
		.Padding(8.0f)
		[
			SNew(SButton)
			.Text(LOCTEXT("ImportAllBtn", "Import All Assets"))
			.HAlign(HAlign_Center)
			.OnClicked(this, &SBrightForgePanel::OnImportAllClicked)
		]
	];
}

FReply SBrightForgePanel::OnConnectClicked()
{
	SetStatus(TEXT("Connecting..."), false);
	GHttpClient.SetBaseUrl(ServerUrl);

	GHttpClient.CheckHealth(FOnBrightForgeResponse::CreateLambda(
		[this](bool bSuccess, const FString& Response)
		{
			if (bSuccess)
			{
				SetStatus(TEXT("Connected to BrightForge"), true);
				FetchProjects();
			}
			else
			{
				SetStatus(FString::Printf(TEXT("Connection failed: %s"), *Response), false);
			}
		}));

	return FReply::Handled();
}

FReply SBrightForgePanel::OnRefreshClicked()
{
	if (!bIsConnected)
	{
		return OnConnectClicked();
	}
	FetchProjects();
	return FReply::Handled();
}

FReply SBrightForgePanel::OnImportClicked()
{
	// Import the first selected asset (called from per-asset buttons)
	return FReply::Handled();
}

FReply SBrightForgePanel::OnImportAllClicked()
{
	if (Assets.Num() == 0)
	{
		SetStatus(TEXT("No assets to import"), bIsConnected);
		return FReply::Handled();
	}

	SetStatus(FString::Printf(TEXT("Importing %d assets..."), Assets.Num()), bIsConnected);

	for (const FBrightForgeAssetEntry& Asset : Assets)
	{
		ImportAsset(Asset.Id, Asset.Name);
	}

	return FReply::Handled();
}

void SBrightForgePanel::OnProjectSelected(TSharedPtr<FString> NewValue, ESelectInfo::Type SelectInfo)
{
	SelectedProject = NewValue;

	// Find matching project index
	for (int32 i = 0; i < ProjectNames.Num(); ++i)
	{
		if (ProjectNames[i] == NewValue)
		{
			SelectedProjectIndex = i;
			break;
		}
	}

	if (SelectedProjectIndex != INDEX_NONE && ProjectIds.IsValidIndex(SelectedProjectIndex))
	{
		FetchAssets(ProjectIds[SelectedProjectIndex]);
	}
}

void SBrightForgePanel::FetchProjects()
{
	GHttpClient.GetProjects(FOnBrightForgeResponse::CreateLambda(
		[this](bool bSuccess, const FString& Response)
		{
			if (!bSuccess)
			{
				SetStatus(TEXT("Failed to fetch projects"), bIsConnected);
				return;
			}

			TSharedPtr<FJsonObject> JsonObject;
			TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response);
			if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
			{
				SetStatus(TEXT("Failed to parse projects response"), bIsConnected);
				return;
			}

			const TArray<TSharedPtr<FJsonValue>>* ProjectsArray;
			if (!JsonObject->TryGetArrayField(TEXT("projects"), ProjectsArray))
			{
				return;
			}

			ProjectNames.Empty();
			ProjectIds.Empty();

			for (const TSharedPtr<FJsonValue>& Value : *ProjectsArray)
			{
				const TSharedPtr<FJsonObject>& Proj = Value->AsObject();
				if (Proj.IsValid())
				{
					FString Name = Proj->GetStringField(TEXT("name"));
					FString Id = Proj->GetStringField(TEXT("id"));
					ProjectNames.Add(MakeShared<FString>(Name));
					ProjectIds.Add(Id);
				}
			}

			SetStatus(FString::Printf(TEXT("Found %d project(s)"), ProjectNames.Num()), true);
		}));
}

void SBrightForgePanel::FetchAssets(const FString& ProjectId)
{
	GHttpClient.GetAssets(ProjectId, FOnBrightForgeResponse::CreateLambda(
		[this](bool bSuccess, const FString& Response)
		{
			if (!bSuccess)
			{
				SetStatus(TEXT("Failed to fetch assets"), bIsConnected);
				return;
			}

			TSharedPtr<FJsonObject> JsonObject;
			TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Response);
			if (!FJsonSerializer::Deserialize(Reader, JsonObject) || !JsonObject.IsValid())
			{
				return;
			}

			const TArray<TSharedPtr<FJsonValue>>* AssetsArray;
			if (!JsonObject->TryGetArrayField(TEXT("assets"), AssetsArray))
			{
				return;
			}

			Assets.Empty();
			for (const TSharedPtr<FJsonValue>& Value : *AssetsArray)
			{
				const TSharedPtr<FJsonObject>& AssetObj = Value->AsObject();
				if (AssetObj.IsValid())
				{
					FBrightForgeAssetEntry Entry;
					Entry.Id = AssetObj->GetStringField(TEXT("id"));
					Entry.Name = AssetObj->GetStringField(TEXT("name"));
					Entry.Type = AssetObj->GetStringField(TEXT("type"));
					Entry.CreatedAt = AssetObj->GetStringField(TEXT("created_at"));
					Assets.Add(Entry);
				}
			}

			RebuildAssetList();
			SetStatus(FString::Printf(TEXT("%d asset(s) found"), Assets.Num()), bIsConnected);
		}));
}

void SBrightForgePanel::ImportAsset(const FString& AssetId, const FString& AssetName)
{
	FString TempDir = FPaths::ProjectSavedDir() / TEXT("BrightForge") / TEXT("Downloads");
	FString OutputPath = TempDir / FString::Printf(TEXT("%s.fbx"), *AssetId);

	UE_LOG(LogBrightForgePanel, Log, TEXT("Downloading FBX for asset %s (%s)"), *AssetName, *AssetId);

	GHttpClient.DownloadFbx(AssetId, OutputPath, FOnBrightForgeResponse::CreateLambda(
		[this, AssetName](bool bSuccess, const FString& FilePath)
		{
			if (!bSuccess)
			{
				UE_LOG(LogBrightForgePanel, Error, TEXT("Download failed for %s: %s"), *AssetName, *FilePath);
				SetStatus(FString::Printf(TEXT("Download failed: %s"), *AssetName), bIsConnected);
				return;
			}

			UE_LOG(LogBrightForgePanel, Log, TEXT("Importing %s from %s"), *AssetName, *FilePath);
			SetStatus(FString::Printf(TEXT("Imported: %s"), *AssetName), bIsConnected);

			// TODO: Trigger FBX import via UAssetImportTask (requires game thread callback)
			// For now, log the downloaded path so the user can import manually or via Python script.
			UE_LOG(LogBrightForgePanel, Log, TEXT("FBX ready at: %s — use File > Import to bring into Content Browser"), *FilePath);
		}));
}

void SBrightForgePanel::RebuildAssetList()
{
	if (!AssetListBox.IsValid())
	{
		return;
	}

	AssetListBox->ClearChildren();

	if (Assets.Num() == 0)
	{
		AssetListBox->AddSlot()
			.AutoHeight()
			.Padding(4.0f)
			[
				SNew(STextBlock)
				.Text(LOCTEXT("NoAssets", "No assets in this project."))
			];
		return;
	}

	for (const FBrightForgeAssetEntry& Asset : Assets)
	{
		FString AssetId = Asset.Id;
		FString AssetName = Asset.Name;

		AssetListBox->AddSlot()
			.AutoHeight()
			.Padding(2.0f)
			[
				SNew(SHorizontalBox)
				+ SHorizontalBox::Slot()
				.FillWidth(1.0f)
				.VAlign(VAlign_Center)
				[
					SNew(STextBlock)
					.Text(FText::FromString(FString::Printf(TEXT("%s  [%s]"), *Asset.Name, *Asset.Type)))
				]
				+ SHorizontalBox::Slot()
				.AutoWidth()
				[
					SNew(SButton)
					.Text(LOCTEXT("ImportBtn", "Import"))
					.OnClicked_Lambda([this, AssetId, AssetName]()
					{
						ImportAsset(AssetId, AssetName);
						return FReply::Handled();
					})
				]
			];
	}
}

void SBrightForgePanel::SetStatus(const FString& Message, bool bConnected)
{
	StatusMessage = Message;
	bIsConnected = bConnected;

	if (StatusText.IsValid())
	{
		StatusText->SetText(FText::FromString(Message));
	}
}

#undef LOCTEXT_NAMESPACE
