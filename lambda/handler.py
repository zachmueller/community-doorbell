import boto3
import json
import os
from datetime import datetime, timezone

s3 = boto3.client('s3')
sns = boto3.client('sns')

BUCKET = os.environ['CONFIG_BUCKET']
CONFIG_KEY = os.environ['CONFIG_KEY']
TOPIC_ARN = os.environ['TOPIC_ARN']


def get_config():
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=CONFIG_KEY)
        return json.loads(obj['Body'].read())
    except Exception:
        return {'active': False}


def is_active(config):
    if not config.get('active', False):
        return False
    now = datetime.now(timezone.utc)
    start = config.get('start')
    end = config.get('end')
    if start and now < datetime.fromisoformat(start):
        return False
    if end and now > datetime.fromisoformat(end):
        return False
    return True


def respond(status_code, body):
    return {
        'statusCode': status_code,
        'headers': {'Content-Type': 'application/json'},
        'body': json.dumps(body),
    }


def handler(event, context):
    method = event.get('requestContext', {}).get('http', {}).get('method', '')
    path = event.get('rawPath', '')

    if method == 'GET' and '/status' in path:
        config = get_config()
        return respond(200, {'active': is_active(config)})

    if method == 'POST' and '/ring' in path:
        config = get_config()

        if not is_active(config):
            return respond(200, {
                'message': 'No event is happening right now.',
                'rang': False,
            })

        message = config.get('message', 'Someone is at the door!')
        sns.publish(TopicArn=TOPIC_ARN, Message=message)

        return respond(200, {
            'message': 'Organizers have been notified! Someone will be down shortly.',
            'rang': True,
        })

    return respond(404, {'error': 'Not found'})
