/** BrightForge HTTP Client implementation using FHttpModule. */

#include "BrightForgeHttpClient.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/FileHelper.h"

DEFINE_LOG_CATEGORY_STATIC(LogBrightForgeHttp, Log, All);

void FBrightForgeHttpClient::SetBaseUrl(const FString& InUrl)
{
	BaseUrl = InUrl;
	if (!BaseUrl.EndsWith(TEXT("/api/forge3d")))
	{
		// Ensure the base URL points to the forge3d API
		if (BaseUrl.EndsWith(TEXT("/")))
		{
			BaseUrl.RemoveAt(BaseUrl.Len() - 1);
		}
		BaseUrl += TEXT("/api/forge3d");
	}
	UE_LOG(LogBrightForgeHttp, Log, TEXT("Base URL set to: %s"), *BaseUrl);
}

void FBrightForgeHttpClient::GetProjects(FOnBrightForgeResponse OnComplete)
{
	SendGetRequest(TEXT("/projects"), OnComplete);
}

void FBrightForgeHttpClient::GetAssets(const FString& ProjectId, FOnBrightForgeResponse OnComplete)
{
	SendGetRequest(FString::Printf(TEXT("/projects/%s/assets"), *ProjectId), OnComplete);
}

void FBrightForgeHttpClient::DownloadFbx(const FString& AssetId, const FString& OutputPath, FOnBrightForgeResponse OnComplete)
{
	FString Endpoint = FString::Printf(TEXT("/assets/%s/download?format=fbx"), *AssetId);
	SendDownloadRequest(Endpoint, OutputPath, OnComplete);
}

void FBrightForgeHttpClient::GetMaterialPresets(FOnBrightForgeResponse OnComplete)
{
	SendGetRequest(TEXT("/material-presets"), OnComplete);
}

void FBrightForgeHttpClient::CheckHealth(FOnBrightForgeResponse OnComplete)
{
	SendGetRequest(TEXT("/bridge"), OnComplete);
}

void FBrightForgeHttpClient::SendGetRequest(const FString& Endpoint, FOnBrightForgeResponse OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl + Endpoint);
	Request->SetVerb(TEXT("GET"));
	Request->SetHeader(TEXT("Accept"), TEXT("application/json"));

	Request->OnProcessRequestComplete().BindLambda(
		[OnComplete](FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bConnected)
		{
			if (bConnected && Resp.IsValid() && EHttpResponseCodes::IsOk(Resp->GetResponseCode()))
			{
				OnComplete.ExecuteIfBound(true, Resp->GetContentAsString());
			}
			else
			{
				FString ErrorMsg = bConnected && Resp.IsValid()
					? FString::Printf(TEXT("HTTP %d: %s"), Resp->GetResponseCode(), *Resp->GetContentAsString())
					: TEXT("Connection failed");
				UE_LOG(LogBrightForgeHttp, Warning, TEXT("Request failed: %s"), *ErrorMsg);
				OnComplete.ExecuteIfBound(false, ErrorMsg);
			}
		});

	Request->ProcessRequest();
}

void FBrightForgeHttpClient::SendDownloadRequest(const FString& Endpoint, const FString& OutputPath, FOnBrightForgeResponse OnComplete)
{
	TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
	Request->SetURL(BaseUrl + Endpoint);
	Request->SetVerb(TEXT("GET"));

	Request->OnProcessRequestComplete().BindLambda(
		[OnComplete, OutputPath](FHttpRequestPtr Req, FHttpResponsePtr Resp, bool bConnected)
		{
			if (bConnected && Resp.IsValid() && EHttpResponseCodes::IsOk(Resp->GetResponseCode()))
			{
				const TArray<uint8>& Content = Resp->GetContent();
				if (FFileHelper::SaveArrayToFile(Content, *OutputPath))
				{
					UE_LOG(LogBrightForgeHttp, Log, TEXT("Downloaded %d bytes to %s"), Content.Num(), *OutputPath);
					OnComplete.ExecuteIfBound(true, OutputPath);
				}
				else
				{
					UE_LOG(LogBrightForgeHttp, Error, TEXT("Failed to write file: %s"), *OutputPath);
					OnComplete.ExecuteIfBound(false, TEXT("Failed to write file"));
				}
			}
			else
			{
				FString ErrorMsg = bConnected && Resp.IsValid()
					? FString::Printf(TEXT("HTTP %d"), Resp->GetResponseCode())
					: TEXT("Connection failed");
				UE_LOG(LogBrightForgeHttp, Warning, TEXT("Download failed: %s"), *ErrorMsg);
				OnComplete.ExecuteIfBound(false, ErrorMsg);
			}
		});

	Request->ProcessRequest();
}
