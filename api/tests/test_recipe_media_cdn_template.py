from pathlib import Path
from typing import Any

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
TEMPLATE_PATH = REPOSITORY_ROOT / "infra/cloudformation/recipe-media-cdn.yaml"


class CloudFormationLoader(yaml.SafeLoader):
    """Preserve CloudFormation short-form intrinsic functions while loading YAML."""

    pass


def _construct_cloudformation_tag(
    loader: CloudFormationLoader,
    tag_suffix: str,
    node: yaml.Node,
) -> dict[str, Any]:
    """Convert a short-form intrinsic tag into its long-form mapping."""

    if isinstance(node, yaml.ScalarNode):
        value: Any = loader.construct_scalar(node)
    elif isinstance(node, yaml.SequenceNode):
        value = loader.construct_sequence(node)
    else:
        value = loader.construct_mapping(node)
    return {tag_suffix: value}


CloudFormationLoader.add_multi_constructor("!", _construct_cloudformation_tag)


def _template() -> dict[str, Any]:
    """Load the recipe media CDN template for contract assertions."""

    return yaml.load(TEMPLATE_PATH.read_text(), Loader=CloudFormationLoader)


def test_stack_never_owns_the_existing_thumbnail_bucket_or_policy() -> None:
    """Keep the existing bucket and its policy outside CloudFormation ownership."""

    template = _template()
    resources = template["Resources"]
    resource_types = {resource["Type"] for resource in resources.values()}

    assert "AWS::S3::Bucket" not in resource_types
    assert "AWS::S3::BucketPolicy" not in resource_types
    assert "KeepLegacyPublicRead" not in template["Parameters"]


def test_distribution_uses_signed_origin_and_managed_immutable_cache_policy() -> None:
    """Attach signed origin access and stable managed policies to the distribution."""

    resources = _template()["Resources"]
    oac = resources["RecipeMediaOriginAccessControl"]["Properties"]["OriginAccessControlConfig"]
    distribution = resources["RecipeMediaDistribution"]["Properties"]["DistributionConfig"]
    behavior = distribution["DefaultCacheBehavior"]
    origin = distribution["Origins"][0]

    assert oac["OriginAccessControlOriginType"] == "s3"
    assert oac["SigningBehavior"] == "always"
    assert oac["SigningProtocol"] == "sigv4"
    assert origin["Id"] == "RecipeThumbnailS3Origin"
    assert origin["OriginAccessControlId"] == {"GetAtt": "RecipeMediaOriginAccessControl.Id"}
    assert origin["S3OriginConfig"] == {"OriginAccessIdentity": ""}
    assert behavior["TargetOriginId"] == "RecipeThumbnailS3Origin"
    assert behavior["CachePolicyId"] == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    assert behavior["ResponseHeadersPolicyId"] == ("eaab4381-ed33-4a86-88ca-d9558dc6cd63")
    assert behavior["ViewerProtocolPolicy"] == "redirect-to-https"
    assert behavior["AllowedMethods"] == ["GET", "HEAD", "OPTIONS"]
    assert distribution["HttpVersion"] == "http2and3"
    assert distribution["IPV6Enabled"] is True
    assert distribution["WebACLId"] == {"GetAtt": "RecipeMediaWebAcl.Arn"}
    assert distribution["Aliases"] == [{"Ref": "MediaDomainName"}]
    assert distribution["ViewerCertificate"] == {
        "AcmCertificateArn": {"Ref": "AcmCertificateArn"},
        "MinimumProtocolVersion": "TLSv1.2_2021",
        "SslSupportMethod": "sni-only",
    }


def test_custom_domain_is_required_and_dotted_bucket_names_are_rejected() -> None:
    """Require modern viewer TLS and an HTTPS-compatible S3 origin hostname."""

    parameters = _template()["Parameters"]

    assert "Default" not in parameters["MediaDomainName"]
    assert "Default" not in parameters["AcmCertificateArn"]
    assert "." not in parameters["ThumbnailBucketName"]["AllowedPattern"]


def test_waf_blocks_non_thumbnail_paths_and_rate_limits_thumbnail_requests() -> None:
    """Block non-thumbnail viewer paths and bound abuse of the public path."""

    template = _template()
    web_acl = template["Resources"]["RecipeMediaWebAcl"]["Properties"]
    default_action_condition = web_acl["DefaultAction"]["If"]
    rules_condition = web_acl["Rules"]["If"]
    ordered_rules = rules_condition[1]

    assert default_action_condition == [
        "ApplyThumbnailWafRules",
        {"Block": {}},
        {"Allow": {}},
    ]
    assert rules_condition[0] == "ApplyThumbnailWafRules"
    assert rules_condition[2] == {"Ref": "AWS::NoValue"}
    assert web_acl["VisibilityConfig"]["CloudWatchMetricsEnabled"] == {
        "If": ["ApplyThumbnailWafRules", True, False]
    }
    assert web_acl["VisibilityConfig"]["SampledRequestsEnabled"] == {
        "If": ["ApplyThumbnailWafRules", True, False]
    }
    assert [rule["Name"] for rule in ordered_rules] == [
        "RateLimitThumbnailRequests",
        "AllowThumbnailPaths",
    ]
    rules = {rule["Name"]: rule for rule in ordered_rules}

    assert rules["RateLimitThumbnailRequests"]["Priority"] == 0
    assert rules["RateLimitThumbnailRequests"]["Action"] == {"Block": {}}
    assert rules["AllowThumbnailPaths"]["Priority"] == 1
    assert rules["AllowThumbnailPaths"]["Action"] == {"Allow": {}}
    allow_statement = rules["AllowThumbnailPaths"]["Statement"]["ByteMatchStatement"]
    assert allow_statement["FieldToMatch"] == {"UriPath": {}}
    assert allow_statement["PositionalConstraint"] == "STARTS_WITH"
    assert allow_statement["SearchString"] == "/thumbnails/"

    rate_statement = rules["RateLimitThumbnailRequests"]["Statement"]["RateBasedStatement"]
    assert rate_statement["AggregateKeyType"] == "IP"
    assert rate_statement["EvaluationWindowSec"] == 300
    assert rate_statement["Limit"] == {"Ref": "ThumbnailRateLimit"}
    assert rate_statement["ScopeDownStatement"]["ByteMatchStatement"] == {
        "FieldToMatch": {"UriPath": {}},
        "PositionalConstraint": "STARTS_WITH",
        "SearchString": "/thumbnails/",
        "TextTransformations": [{"Priority": 0, "Type": "NONE"}],
    }


def test_waf_enforcement_defaults_on_and_bootstrap_is_explicit() -> None:
    """Make the enrollment-only permissive WAF state fail safe on later updates."""

    template = _template()
    parameter = template["Parameters"]["EnforceThumbnailWafRules"]

    assert parameter["Default"] == "true"
    assert parameter["AllowedValues"] == ["false", "true"]
    assert template["Conditions"]["ApplyThumbnailWafRules"] == {
        "Equals": [{"Ref": "EnforceThumbnailWafRules"}, "true"]
    }


def test_distribution_is_covered_by_the_free_flat_rate_plan() -> None:
    """Gate the complete distribution/WAF plan behind a second stack update."""

    template = _template()
    parameter = template["Parameters"]["EnablePricingPlanSubscription"]
    condition = template["Conditions"]["CreatePricingPlanSubscription"]
    subscription = template["Resources"]["RecipeMediaFreePricingPlan"]
    properties = subscription["Properties"]

    assert parameter["Default"] == "false"
    assert parameter["AllowedValues"] == ["false", "true"]
    assert condition == {
        "Equals": [{"Ref": "EnablePricingPlanSubscription"}, "true"]
    }
    assert subscription["Type"] == "AWS::PricingPlanManager::Subscription"
    assert subscription["Condition"] == "CreatePricingPlanSubscription"
    assert properties["PlanFamily"] == "CloudFront"
    assert properties["PlanTier"] == "FREE"
    assert properties["UsageLevel"] == "DEFAULT"
    assert properties["ResourceArns"] == [
        {
            "Sub": (
                "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:"
                "distribution/${RecipeMediaDistribution}"
            )
        },
        {"GetAtt": "RecipeMediaWebAcl.Arn"},
    ]
    assert template["Outputs"]["PricingPlanArn"]["Condition"] == (
        "CreatePricingPlanSubscription"
    )


def test_access_logs_are_privacy_minimized_and_expire() -> None:
    """Retain enough delivery evidence without storing direct viewer identifiers."""

    resources = _template()["Resources"]
    log_group = resources["RecipeMediaAccessLogGroup"]["Properties"]
    source = resources["RecipeMediaAccessLogDeliverySource"]["Properties"]
    destination = resources["RecipeMediaAccessLogDestination"]["Properties"]
    delivery = resources["RecipeMediaAccessLogDelivery"]["Properties"]

    assert log_group["RetentionInDays"] == 14
    assert source["LogType"] == "ACCESS_LOGS"
    assert source["ResourceArn"] == {
        "Sub": (
            "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:"
            "distribution/${RecipeMediaDistribution}"
        )
    }
    assert destination["DeliveryDestinationType"] == "CWL"
    assert destination["OutputFormat"] == "json"
    assert destination["DestinationResourceArn"] == {
        "GetAtt": "RecipeMediaAccessLogGroup.Arn"
    }
    assert delivery["DeliverySourceName"] == {"Ref": "RecipeMediaAccessLogDeliverySource"}
    assert delivery["DeliveryDestinationArn"] == {
        "GetAtt": "RecipeMediaAccessLogDestination.Arn"
    }
    fields = delivery["RecordFields"]
    assert "cs-uri-stem" in fields
    assert "sc-status" in fields
    assert "time-taken" in fields
    assert "c-ip" not in fields
    assert "cs(User-Agent)" not in fields
    assert "cs(Referer)" not in fields
    assert "cs-uri-query" not in fields
    assert "cs(Cookie)" not in fields
    assert "x-forwarded-for" not in fields
