# Route 53 records for hawkesgen.com (the move to Google Cloud). AWS keys come from C:\Projects\hawkesgen\.env and are
# never printed. TTL 60 on everything it writes, so a change takes effect (or is undone) within a minute or two.
#   py -I cloud/dns.py show
#   py -I cloud/dns.py set <name> <type> <value> [<value> ...]   replaces that name's records of that type
#   py -I cloud/dns.py add <name> <type> <value>                  adds one value, keeping the others (TXT next to SES's)
import sys
import boto3

env = {}
for line in open(r'C:\Projects\hawkesgen\.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        env[k] = v.strip().strip('"')
r53 = boto3.Session(aws_access_key_id=env['AWS_ACCESS_KEY_ID'], aws_secret_access_key=env['AWS_SECRET_ACCESS_KEY']).client('route53')
ZONE = [z['Id'] for z in r53.list_hosted_zones()['HostedZones'] if z['Name'] == 'hawkesgen.com.'][0]
fq = lambda n: n if n.endswith('.') else n + '.'
quote = lambda t, v: v if t != 'TXT' or v.startswith('"') else f'"{v}"'


def records(name, rtype):
    out = r53.list_resource_record_sets(HostedZoneId=ZONE, StartRecordName=fq(name), StartRecordType=rtype, MaxItems='1')['ResourceRecordSets']
    return [r['Value'] for r in out[0].get('ResourceRecords', [])] if out and out[0]['Name'] == fq(name) and out[0]['Type'] == rtype else []


def upsert(name, rtype, values):
    ch = {'Action': 'UPSERT', 'ResourceRecordSet': {'Name': fq(name), 'Type': rtype, 'TTL': 60, 'ResourceRecords': [{'Value': quote(rtype, v)} for v in values]}}
    print(fq(name), rtype, '->', ', '.join(quote(rtype, v) for v in values), r53.change_resource_record_sets(HostedZoneId=ZONE, ChangeBatch={'Changes': [ch], 'Comment': 'hawkesgen.com on Google Cloud'})['ChangeInfo']['Status'])


mode = sys.argv[1] if len(sys.argv) > 1 else 'show'
if mode == 'show':
    for x in r53.list_resource_record_sets(HostedZoneId=ZONE)['ResourceRecordSets']:
        if x['Name'] in ('hawkesgen.com.', 'www.hawkesgen.com.') or x['Name'].startswith('_acme-challenge'):
            print(x['Name'], x['Type'], x.get('TTL'), [v['Value'] for v in x.get('ResourceRecords', [])])
elif mode == 'set':
    upsert(sys.argv[2], sys.argv[3], sys.argv[4:])
elif mode == 'add':
    have = records(sys.argv[2], sys.argv[3])
    want = quote(sys.argv[3], sys.argv[4])
    if want in have:
        print(fq(sys.argv[2]), sys.argv[3], 'already has', want)
    else:
        upsert(sys.argv[2], sys.argv[3], have + [want])
else:
    sys.exit('usage: dns.py show | set <name> <type> <values...> | add <name> <type> <value>')
