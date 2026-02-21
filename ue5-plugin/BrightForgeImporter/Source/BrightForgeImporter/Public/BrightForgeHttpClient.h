/** BrightForge HTTP Client - Wrapper for BrightForge Forge3D REST API. */
#pragma once

#include "CoreMinimal.h"

DECLARE_DELEGATE_TwoParams(FOnBrightForgeResponse, bool /** bSuccess */, const FString& /** Response */);

class FBrightForgeHttpClient
{
public:
	void SetBaseUrl(const FString& InUrl);
	const FString& GetBaseUrl() const { return BaseUrl; }

	void GetProjects(FOnBrightForgeResponse OnComplete);
	void GetAssets(const FString& ProjectId, FOnBrightForgeResponse OnComplete);
	void DownloadFbx(const FString& AssetId, const FString& OutputPath, FOnBrightForgeResponse OnComplete);
	void GetMaterialPresets(FOnBrightForgeResponse OnComplete);
	void CheckHealth(FOnBrightForgeResponse OnComplete);

private:
	FString BaseUrl = TEXT("http://localhost:3847/api/forge3d");

	void SendGetRequest(const FString& Endpoint, FOnBrightForgeResponse OnComplete);
	void SendDownloadRequest(const FString& Endpoint, const FString& OutputPath, FOnBrightForgeResponse OnComplete);
};
