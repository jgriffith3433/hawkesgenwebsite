# Moving hawkesgen.com and sickofitgame.com to Cloudflare DNS

**Why (2026-10-28):** Route 53 stopped answering for both domains ("lame delegation"), the AWS key is refused, and
the AWS control server doesn't answer: the AWS account looks suspended. Both domains are **registered with Amazon
Registrar** (paid to 2027-10-16 and 2027-02-07), so their nameservers can only be changed from the AWS console. The
other seven product domains are at GoDaddy and are unaffected.

Checked before writing these files: `https://hawkesgen.com` served by Firebase (199.36.158.100) and
`https://sickofitgame.com` served by GitHub Pages (185.199.108.153) both answer with valid certificates when asked
directly. They only need DNS.

**Done 2026-10-28 (by Claude, `cf` CLI signed in as piercehawkes3@gmail.com):** both zones are on Cloudflare's Free
plan, pending (zone ids `ef6c1f46ca5ab950986d60bd27da2f1e` hawkesgen.com, `369f1916abacc0212d248ef143bdd201`
sickofitgame.com), both files imported (8 and 5 records, all DNS only), and Cloudflare's nameservers already answer
with them. **Both domains' nameservers: `kip.ns.cloudflare.com` and `paityn.ns.cloudflare.com`.** Left: step 2.
Email Routing for step 4 is half done: the destination piercehawkes3@gmail.com is verified and the rule
`support@hawkesgen.com` → it exists; turning Email Routing on (`cf email-routing enable -z hawkesgen.com`, which adds
the MX and SPF records) needs the zone active, so it waits for step 2.

## Steps

1. **Cloudflare (a free account is enough):** Add a domain > `hawkesgen.com` > Free plan. The scan finds nothing
   (Route 53 is down): fine. DNS > Records > Import and Export > import `hawkesgen.com.zone`. Turn every record's
   proxy **off** (grey cloud) if the import turned any on. Do the same for `sickofitgame.com` with
   `sickofitgame.com.zone`. Note the two nameservers Cloudflare gives each domain.
2. **AWS console** (sign in as the account's root user; a suspended account can usually still sign in to pay):
   Route 53 > Registered domains > hawkesgen.com > Actions > Edit name servers: replace the four `awsdns` names with
   Cloudflare's two. Same for sickofitgame.com. If the console refuses, the fastest way back is paying the AWS bill
   (everything on AWS returns, including Route 53), then doing this step.
3. Cloudflare checks the nameservers by itself (minutes to a few hours); the domain shows **Active**. Then
   `https://hawkesgen.com` and `https://sickofitgame.com` work again.
4. **Email** (Cloudflare > Email > Email Routing): turn it on for hawkesgen.com (it adds its MX and SPF records), and
   route `support@hawkesgen.com` to J's Gmail. Sending through Resend is already in the import.
5. **Later, so AWS can't hold the domains again:** transfer both registrations to Cloudflare Registrar (at cost): AWS
   console > the domain > turn off the transfer lock, get the authorization code, then Cloudflare > Domain
   Registration > Transfer. Needs a working AWS console.

## Not in the import, and why

| Name | Was | Now |
|---|---|---|
| `studio`, `gen`, the beta sites (`<sub>`, `dev-<sub>`) | AWS control server 52.0.19.230 | Not answering. They come back with the control VM on Google Cloud (hawkesgen `docs/gcp.md`); add their A records then |
| `cdn` | Gen's S3 bucket | Gen's library moves to Cloud Storage (`storage.provider: "gcs"`); a CDN name then |
| `hawkesnet` (beta Hawkes Net) | AWS | Comes back with the control VM |
| MX `inbound-smtp.us-east-1.amazonaws.com` | SES inbound | Cloudflare Email Routing (step 4) |
| `_amazonses`, SES DKIM CNAMEs | SES sending | Not needed: mail goes out through Resend |
