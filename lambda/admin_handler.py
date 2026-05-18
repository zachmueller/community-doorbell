import os
import json
import boto3
from datetime import datetime

s3 = boto3.client('s3')
BUCKET = os.environ['CONFIG_BUCKET']
CONFIG_KEY = os.environ['CONFIG_KEY']


def handler(event, context):
    method = event.get('requestContext', {}).get('http', {}).get('method', '')
    path = event.get('rawPath', '')

    if method == 'GET' and '/admin/config' in path:
        return get_config()
    if method == 'PUT' and '/admin/config' in path:
        return put_config(event)
    return respond(404, {'error': 'Not found'})


def get_config():
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=CONFIG_KEY)
        config = json.loads(obj['Body'].read())
    except Exception:
        config = {'active': False, 'message': '', 'start': None, 'end': None}
    return respond(200, config)


def put_config(event):
    body = json.loads(event.get('body', '{}'))
    config = {
        'active': bool(body.get('active', False)),
        'message': str(body.get('message', 'Someone is at the door!')),
        'start': body.get('start') or None,
        'end': body.get('end') or None,
    }
    for field in ('start', 'end'):
        if config[field]:
            try:
                datetime.fromisoformat(config[field])
            except ValueError:
                return respond(400, {'error': f'Invalid {field} datetime format'})
    s3.put_object(
        Bucket=BUCKET, Key=CONFIG_KEY,
        Body=json.dumps(config), ContentType='application/json'
    )
    return respond(200, config)


def respond(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        'body': json.dumps(body),
    }
