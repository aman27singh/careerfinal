"""Create a Lambda Function URL for careeros-api to bypass API Gateway's 30s timeout."""
import boto3

lam = boto3.client("lambda", region_name="us-east-1")

try:
    existing = lam.get_function_url_config(FunctionName="careeros-api")
    print("Function URL already exists:", existing["FunctionUrl"])
except lam.exceptions.ResourceNotFoundException:
    print("No function URL - creating...")
    resp = lam.create_function_url_config(
        FunctionName="careeros-api",
        AuthType="NONE",
        Cors={
            "AllowOrigins": ["*"],
            "AllowMethods": ["*"],
            "AllowHeaders": ["*"],
            "ExposeHeaders": ["*"],
            "MaxAge": 86400,
        },
    )
    print("Created Function URL:", resp["FunctionUrl"])
    try:
        lam.add_permission(
            FunctionName="careeros-api",
            StatementId="FunctionURLPublicAccess",
            Action="lambda:InvokeFunctionUrl",
            Principal="*",
            FunctionUrlAuthType="NONE",
        )
        print("Public access permission added")
    except Exception as e:
        print("Permission may already exist:", e)
