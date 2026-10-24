package com.yogimangchi.content.auth.security;

import io.swagger.v3.oas.models.*;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.*;
import org.springdoc.core.customizers.OpenApiCustomizer;
import io.swagger.v3.oas.models.media.*;
import io.swagger.v3.oas.models.responses.ApiResponse;
import java.util.Map;

@Configuration(proxyBeanMethods=false)
public class OpenApiConfig {
    @Bean OpenAPI contentOpenApi() {
        return new OpenAPI().info(new Info().title("Yogimangchi Content API").version("v1"))
                .components(new Components().addSecuritySchemes("memberBearer",new SecurityScheme().type(SecurityScheme.Type.HTTP).scheme("bearer").bearerFormat("JWT")));
    }
    @Bean OpenApiCustomizer authErrorContract() {
        return api -> {
            var schema=new ObjectSchema().addProperty("status",new IntegerSchema()).addProperty("code",new StringSchema()
                    .description("Fixed safe application code; never provider text, tokens or rejected input")).addProperty("detail",new StringSchema());
            api.getComponents().addSchemas("ContentProblem",schema);
            String proof="LOGIN_PROOF_REQUIRED / LOGIN_PROOF_EXPIRED; obtain a fresh social login proof if absent or consumed";
            String credential="AUTHENTICATION_REQUIRED / INVALID_ACCESS_TOKEN / MEMBER_NOT_ACTIVE";
            document(api,"/api/v1/auth/signup",PathItem.HttpMethod.POST,Map.of(
                    "400","INVALID_REQUEST / INVALID_NICKNAME / REQUIRED_CONSENT_MISSING / POLICY_VERSION_REQUIRED",
                    "401",proof,"403","CSRF_INVALID","409","NICKNAME_UNAVAILABLE / MEMBER_ALREADY_EXISTS / POLICY_VERSION_CHANGED / MEMBER_BUSY / RESOURCE_ALREADY_EXISTS"));
            document(api,"/api/v1/auth/login/complete",PathItem.HttpMethod.POST,Map.of(
                    "401",proof+"; AUTHENTICATION_REQUIRED for missing/inactive membership","403","CSRF_INVALID","409","MEMBER_BUSY"));
            document(api,"/api/v1/auth/refresh",PathItem.HttpMethod.POST,Map.of(
                    "401","AUTHENTICATION_REQUIRED; invalid/expired/reused Refresh. No Set-Cookie on failure; do not blindly retry lost rotation responses",
                    "403","CSRF_INVALID","409","MEMBER_BUSY"));
            document(api,"/api/v1/auth/logout",PathItem.HttpMethod.POST,Map.of("403","CSRF_INVALID","409","MEMBER_BUSY"));
            document(api,"/api/v1/auth/flow",PathItem.HttpMethod.GET,Map.of("401",proof+"; AUTHENTICATION_REQUIRED for inactive membership"));
            document(api,"/api/v1/members/me/consents",PathItem.HttpMethod.GET,Map.of("401",credential));
            document(api,"/api/v1/members/me/consents",PathItem.HttpMethod.POST,Map.of(
                    "400","INVALID_REQUEST / REQUIRED_CONSENT_MISSING / POLICY_VERSION_REQUIRED","401",credential,"409","POLICY_VERSION_CHANGED / MEMBER_BUSY"));
            document(api,"/api/v1/members/me/profile",PathItem.HttpMethod.PATCH,Map.of(
                    "400","INVALID_REQUEST / INVALID_NICKNAME / INVALID_PROFILE","401",credential,
                    "409","NICKNAME_UNAVAILABLE / PROFILE_MESSAGE_UPDATE_REQUIRED / MEMBER_BUSY / RESOURCE_ALREADY_EXISTS"));
            document(api,"/api/v1/members/nickname/availability",PathItem.HttpMethod.GET,Map.of("400","INVALID_NICKNAME / INVALID_REQUEST"));
            var lookup=api.getPaths().get("/api/v1/members/nickname/availability");
            if(lookup!=null && lookup.getGet()!=null) lookup.getGet().getResponses().addApiResponse("429",error("RATE_LIMITED; wait Retry-After seconds")
                    .addHeaderObject("Retry-After",new io.swagger.v3.oas.models.headers.Header().schema(new IntegerSchema()).description("Seconds until another lookup may be attempted")));
        };
    }
    private static void document(OpenAPI api,String path,PathItem.HttpMethod method,Map<String,String> errors) {
        var item=api.getPaths().get(path);if(item==null)return;
        var operation=item.readOperationsMap().get(method);if(operation==null)return;
        errors.forEach((status,description)->operation.getResponses().addApiResponse(status,error(description)));
        operation.getResponses().addApiResponse("503",error("SERVICE_TEMPORARILY_UNAVAILABLE; preserve session state and check ambiguous mutation results before retrying"));
    }
    private static ApiResponse error(String description) {
        return new ApiResponse().description(description).content(new Content().addMediaType("application/problem+json",
                new MediaType().schema(new Schema<>().$ref("#/components/schemas/ContentProblem"))));
    }
}
