import os
import json
import boto3

s3 = boto3.client('s3')
BUCKET = os.environ['ALLOWLIST_BUCKET']
ALLOWLIST_KEY = 'admin-allowlist.json'


def get_allowlist():
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=ALLOWLIST_KEY)
        return set(e.lower() for e in json.loads(obj['Body'].read()))
    except Exception:
        return set()


def handler(event, context):
    email = event['request']['userAttributes'].get('email', '').lower()
    allowed = get_allowlist()
    if email not in allowed:
        raise Exception(f'Email {email} is not authorized.')
    event['response']['autoConfirmUser'] = True
    event['response']['autoVerifyEmail'] = True
    return event
