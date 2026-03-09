"""Patch a single file in the existing Lambda zip and redeploy."""
import boto3
import io
import zipfile

S3_BUCKET = "careeros-resumes-985090322407"
LAMBDA_NAME = "careeros-api"
REGION = "us-east-1"
FILE_TO_PATCH = "app/services/market_service.py"
LOCAL_PATH = "/Applications/CareerOS-main/app/services/market_service.py"

s3 = boto3.client("s3", region_name=REGION)
lam = boto3.client("lambda", region_name=REGION)

print("Downloading latest.zip from S3...")
obj = s3.get_object(Bucket=S3_BUCKET, Key="deployments/latest.zip")
zip_bytes = io.BytesIO(obj["Body"].read())
print(f"Downloaded: {len(zip_bytes.getvalue()):,} bytes")

out_buf = io.BytesIO()
with zipfile.ZipFile(zip_bytes, "r") as zin, zipfile.ZipFile(out_buf, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename == FILE_TO_PATCH:
            with open(LOCAL_PATH, "rb") as f:
                zout.writestr(item, f.read())
            print(f"Patched: {FILE_TO_PATCH}")
        else:
            zout.writestr(item, zin.read(item.filename))

out_buf.seek(0)
data = out_buf.getvalue()
print(f"Uploading patched zip ({len(data):,} bytes)...")
s3.put_object(Bucket=S3_BUCKET, Key="deployments/patched.zip", Body=data)

print("Updating Lambda function code...")
resp = lam.update_function_code(
    FunctionName=LAMBDA_NAME,
    S3Bucket=S3_BUCKET,
    S3Key="deployments/patched.zip",
)
print("Lambda State:", resp.get("State"))
print("LastUpdateStatus:", resp.get("LastUpdateStatus"))
print("Done.")
