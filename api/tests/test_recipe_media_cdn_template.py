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


def test_cdn_can_read_only_thumbnail_objects() -> None:
    """Keep every CDN and compatibility read scoped to recipe thumbnails."""

    template = _template()
    resources = template["Resources"]
    bucket_policy = resources["ThumbnailBucketPolicy"]

    assert bucket_policy["DeletionPolicy"] == "Retain"
    assert bucket_policy["UpdateReplacePolicy"] == "Retain"
    assert all(resource["Type"] != "AWS::S3::Bucket" for resource in resources.values())

    statements = bucket_policy["Properties"]["PolicyDocument"]["Statement"]
    assert len(statements) == 2
    cloudfront_read = statements[0]
    assert cloudfront_read == {
        "Sid": "AllowCloudFrontReadRecipeThumbnails",
        "Effect": "Allow",
        "Principal": {"Service": "cloudfront.amazonaws.com"},
        "Action": "s3:GetObject",
        "Resource": {
            "Sub": (
                "arn:${AWS::Partition}:s3:::${ThumbnailBucketName}/thumbnails/*"
            )
        },
        "Condition": {
            "StringEquals": {
                "AWS:SourceArn": {
                    "Sub": (
                        "arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:"
                        "distribution/${RecipeMediaDistribution}"
                    )
                },
                "AWS:SourceAccount": {"Ref": "AWS::AccountId"},
            }
        },
    }

    assert statements[1] == {
        "If": [
            "PreserveLegacyPublicRead",
            {
                "Sid": "PublicReadForThumbnails",
                "Effect": "Allow",
                "Principal": "*",
                "Action": "s3:GetObject",
                "Resource": {
                    "Sub": (
                        "arn:${AWS::Partition}:s3:::${ThumbnailBucketName}/"
                        "thumbnails/*"
                    )
                },
            },
            {"Ref": "AWS::NoValue"},
        ]
    }


def test_distribution_uses_signed_origin_and_managed_immutable_cache_policy() -> None:
    """Attach signed origin access and stable managed policies to the distribution."""

    resources = _template()["Resources"]
    oac = resources["RecipeMediaOriginAccessControl"]["Properties"][
        "OriginAccessControlConfig"
    ]
    distribution = resources["RecipeMediaDistribution"]["Properties"][
        "DistributionConfig"
    ]
    behavior = distribution["DefaultCacheBehavior"]
    origin = distribution["Origins"][0]

    assert oac["OriginAccessControlOriginType"] == "s3"
    assert oac["SigningBehavior"] == "always"
    assert oac["SigningProtocol"] == "sigv4"
    assert origin["Id"] == "RecipeThumbnailS3Origin"
    assert origin["OriginAccessControlId"] == {
        "GetAtt": "RecipeMediaOriginAccessControl.Id"
    }
    assert origin["S3OriginConfig"] == {"OriginAccessIdentity": ""}
    assert behavior["CachePolicyId"] == "658327ea-f89d-4fab-a63d-7e88639e58f6"
    assert behavior["ResponseHeadersPolicyId"] == (
        "5cc3b908-e619-4b99-88e5-2cf7f45965bd"
    )
    assert behavior["ViewerProtocolPolicy"] == "redirect-to-https"
    assert behavior["AllowedMethods"] == ["GET", "HEAD", "OPTIONS"]
    assert distribution["HttpVersion"] == "http2and3"
    assert distribution["IPV6Enabled"] is True
    assert distribution["WebACLId"] == {"GetAtt": "RecipeMediaWebAcl.Arn"}


def test_waf_blocks_non_thumbnail_paths_and_rate_limits_thumbnail_requests() -> None:
    """Block non-thumbnail viewer paths and bound abuse of the public path."""

    web_acl = _template()["Resources"]["RecipeMediaWebAcl"]["Properties"]
    ordered_rules = web_acl["Rules"]
    assert [rule["Name"] for rule in ordered_rules] == [
        "RateLimitThumbnailRequests",
        "AllowThumbnailPaths",
    ]
    rules = {rule["Name"]: rule for rule in ordered_rules}

    assert web_acl["DefaultAction"] == {"Block": {}}
    assert rules["RateLimitThumbnailRequests"]["Priority"] == 0
    assert rules["RateLimitThumbnailRequests"]["Action"] == {"Block": {}}
    assert rules["AllowThumbnailPaths"]["Priority"] == 1
    assert rules["AllowThumbnailPaths"]["Action"] == {"Allow": {}}
    allow_statement = rules["AllowThumbnailPaths"]["Statement"]["ByteMatchStatement"]
    assert allow_statement["FieldToMatch"] == {"UriPath": {}}
    assert allow_statement["PositionalConstraint"] == "STARTS_WITH"
    assert allow_statement["SearchString"] == "/thumbnails/"

    rate_statement = rules["RateLimitThumbnailRequests"]["Statement"][
        "RateBasedStatement"
    ]
    assert rate_statement["AggregateKeyType"] == "IP"
    assert rate_statement["EvaluationWindowSec"] == 300
    assert rate_statement["Limit"] == {"Ref": "ThumbnailRateLimit"}
    assert rate_statement["ScopeDownStatement"]["ByteMatchStatement"] == {
        "FieldToMatch": {"UriPath": {}},
        "PositionalConstraint": "STARTS_WITH",
        "SearchString": "/thumbnails/",
        "TextTransformations": [{"Priority": 0, "Type": "NONE"}],
    }


def test_distribution_is_covered_by_the_free_flat_rate_plan() -> None:
    """Associate the distribution and WAF with one zero-cost pricing plan."""

    subscription = _template()["Resources"]["RecipeMediaFreePricingPlan"]
    properties = subscription["Properties"]

    assert subscription["Type"] == "AWS::PricingPlanManager::Subscription"
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
