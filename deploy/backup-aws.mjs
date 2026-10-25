// Off-box backups for the portal box: an S3 bucket for portal backups, an instance role that may only PutObject there,
// and daily EBS snapshots of the box's volume. Dry-run by default: prints what it would make and changes nothing (it
// does not even call AWS). --apply creates it with the `aws` CLI (J's PC, credentials that can manage S3, IAM, EC2, DLM;
// costs a few dollars a month). Idempotent: run it again to repair.
//   node deploy/backup-aws.mjs [--apply] [--region us-east-1] [--bucket <name>] [--ip 54.163.56.66] [--account <id>]
// Afterwards put PORTAL_BACKUP_BUCKET=<bucket> (and PORTAL_BACKUP_REGION) in the box's .env (deploy/setup.mjs --env).
import { spawnSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const apply = process.argv.includes('--apply');
const region = arg('region', 'us-east-1');
const account = arg('account', '028793236279'); // the account of s3://hawkes-mail-028793236279
const bucket = arg('bucket', `hawkes-portal-backups-${account}`);
const ip = arg('ip', '54.163.56.66'); // hawkes-gen-public's Elastic IP
const PREFIX = 'portal/';
const ROLE = 'hawkesgen-portal-backup-role';
const PROFILE = 'hawkesgen-portal-backup-profile';
const TAG = { Key: 'hawkes-backup', Value: 'portal' };
const KEEP_SNAPSHOTS = 14;
const LIFECYCLE_DAYS = 90;

const trust = { Version: '2012-10-17', Statement: [{ Effect: 'Allow', Principal: { Service: 'ec2.amazonaws.com' }, Action: 'sts:AssumeRole' }] };
const putOnly = { Version: '2012-10-17', Statement: [{ Sid: 'PortalBackupsPutOnly', Effect: 'Allow', Action: 's3:PutObject', Resource: `arn:aws:s3:::${bucket}/${PREFIX}*` }] };
const lifecycle = { Rules: [{ ID: 'portal-backups-90-days', Status: 'Enabled', Filter: { Prefix: PREFIX }, Expiration: { Days: LIFECYCLE_DAYS }, NoncurrentVersionExpiration: { NoncurrentDays: LIFECYCLE_DAYS }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 7 } }] };
const dlm = {
  ResourceTypes: ['VOLUME'],
  TargetTags: [TAG],
  Schedules: [{ Name: 'daily', CreateRule: { Interval: 24, IntervalUnit: 'HOURS', Times: ['03:00'] }, RetainRule: { Count: KEEP_SNAPSHOTS }, CopyTags: true, TagsToAdd: [{ Key: 'made-by', Value: 'dlm-portal-backup' }] }],
};

console.log(`${apply ? 'APPLYING' : 'DRY RUN (nothing is created; add --apply)'} — region ${region}, account ${account}\n`);
console.log(`S3 bucket   s3://${bucket}  (private: all public access blocked; versioned; encrypted AES256)`);
console.log(`            lifecycle: objects under ${PREFIX} and their old versions expire after ${LIFECYCLE_DAYS} days`);
console.log(`IAM role    ${ROLE} (EC2 trust) in instance profile ${PROFILE}, attached to the instance with Elastic IP ${ip}`);
console.log(`            policy: s3:PutObject on arn:aws:s3:::${bucket}/${PREFIX}*   (nothing else: no read, list or delete)`);
console.log(`            if the box already has a profile, the PutObject policy is added to that role instead`);
console.log(`Snapshots   Data Lifecycle Manager: daily 03:00 UTC, kept ${KEEP_SNAPSHOTS} days, for volumes tagged ${TAG.Key}=${TAG.Value}`);
console.log(`            (the box's root volume gets that tag; DLM role AWSDataLifecycleManagerDefaultRole)`);
console.log(`Cost        a few dollars a month (S3 for ~90 days of hourly-at-most daily copies; 14 EBS snapshots).`);
console.log(`Box .env    PORTAL_BACKUP_BUCKET=${bucket}   PORTAL_BACKUP_REGION=${region}\n`);
console.log('Bucket policy / role policy / lifecycle / DLM policy:');
console.log(JSON.stringify({ rolePolicy: putOnly, lifecycle, dlm }, null, 2));
if (!apply) process.exit(0);

function aws(args, { json = true, allowFail = false, input } = {}) {
  const r = spawnSync('aws', [...args, '--region', region, ...(json ? ['--output', 'json'] : [])], { encoding: 'utf8', input, windowsHide: true });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`aws ${args.slice(0, 2).join(' ')} failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-2).join(' | ')}`);
  }
  return json && r.stdout.trim() ? JSON.parse(r.stdout) : r.stdout.trim();
}
const step = (s) => console.log(`[aws] ${s}`);

step('instance');
const inst = aws(['ec2', 'describe-instances', '--filters', `Name=network-interface.addresses.association.public-ip,Values=${ip}`, 'Name=instance-state-name,Values=running']).Reservations?.[0]?.Instances?.[0];
if (!inst) throw new Error(`No running instance with ${ip}`);
const id = inst.InstanceId;
const volumes = inst.BlockDeviceMappings.map((b) => b.Ebs.VolumeId);

step(`bucket ${bucket}`);
if (aws(['s3api', 'head-bucket', '--bucket', bucket], { json: false, allowFail: true } ) === null) {
  aws(['s3api', 'create-bucket', '--bucket', bucket, ...(region === 'us-east-1' ? [] : ['--create-bucket-configuration', `LocationConstraint=${region}`])]);
}
aws(['s3api', 'put-public-access-block', '--bucket', bucket, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true'], { json: false });
aws(['s3api', 'put-bucket-versioning', '--bucket', bucket, '--versioning-configuration', 'Status=Enabled'], { json: false });
aws(['s3api', 'put-bucket-encryption', '--bucket', bucket, '--server-side-encryption-configuration', JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] })], { json: false });
aws(['s3api', 'put-bucket-lifecycle-configuration', '--bucket', bucket, '--lifecycle-configuration', JSON.stringify(lifecycle)], { json: false });

step('instance role');
const assoc = aws(['ec2', 'describe-iam-instance-profile-associations', '--filters', `Name=instance-id,Values=${id}`]).IamInstanceProfileAssociations?.[0];
let roleName = ROLE;
if (assoc) {
  const profileName = assoc.IamInstanceProfile.Arn.split('/').pop();
  roleName = aws(['iam', 'get-instance-profile', '--instance-profile-name', profileName]).InstanceProfile.Roles[0].RoleName;
  console.log(`  the box already has role ${roleName}: adding the policy to it`);
} else {
  if (!aws(['iam', 'get-role', '--role-name', ROLE], { allowFail: true })) aws(['iam', 'create-role', '--role-name', ROLE, '--assume-role-policy-document', JSON.stringify(trust)]);
  if (!aws(['iam', 'get-instance-profile', '--instance-profile-name', PROFILE], { allowFail: true })) {
    aws(['iam', 'create-instance-profile', '--instance-profile-name', PROFILE]);
    aws(['iam', 'add-role-to-instance-profile', '--instance-profile-name', PROFILE, '--role-name', ROLE]);
  }
}
aws(['iam', 'put-role-policy', '--role-name', roleName, '--policy-name', 'portal-backup-put-only', '--policy-document', JSON.stringify(putOnly)], { json: false });
if (!assoc) {
  // a new profile needs a few seconds before EC2 accepts it
  for (let i = 0; i < 6; i++) {
    if (aws(['ec2', 'associate-iam-instance-profile', '--instance-id', id, '--iam-instance-profile', `Name=${PROFILE}`], { allowFail: true })) break;
    if (i === 5) throw new Error('could not attach the instance profile');
    spawnSync('sleep', ['5']);
  }
}

step('snapshots (DLM)');
aws(['ec2', 'create-tags', '--resources', ...volumes, '--tags', `Key=${TAG.Key},Value=${TAG.Value}`], { json: false });
let dlmRole = aws(['iam', 'get-role', '--role-name', 'AWSDataLifecycleManagerDefaultRole'], { allowFail: true })?.Role?.Arn;
if (!dlmRole) { aws(['dlm', 'create-default-role', '--resource-type', 'snapshot'], { json: false }); dlmRole = `arn:aws:iam::${account}:role/service-role/AWSDataLifecycleManagerDefaultRole`; }
const existing = aws(['dlm', 'get-lifecycle-policies']).Policies?.find((p) => p.Description === 'hawkesgen portal daily snapshots');
if (existing) aws(['dlm', 'update-lifecycle-policy', '--policy-id', existing.PolicyId, '--execution-role-arn', dlmRole, '--state', 'ENABLED', '--policy-details', JSON.stringify(dlm)], { json: false });
else aws(['dlm', 'create-lifecycle-policy', '--description', 'hawkesgen portal daily snapshots', '--state', 'ENABLED', '--execution-role-arn', dlmRole, '--policy-details', JSON.stringify(dlm)]);
console.log(`\nDone. Now set PORTAL_BACKUP_BUCKET=${bucket} and PORTAL_BACKUP_REGION=${region} in the box's .env.`);
