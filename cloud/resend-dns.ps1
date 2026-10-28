# Resend's DNS records for sending as hawkesgen.com (Resend dashboard > Domains > hawkesgen.com, 2026-10-28):
# the DKIM key, the two return-path CNAMEs and a monitoring-only DMARC policy. None of them touches SES's existing
# records (MX, _amazonses, its DKIM CNAMEs), so support@ keeps arriving the way it does today.
#   powershell -ExecutionPolicy Bypass -File C:\Projects\hawkesgenwebsite\cloud\resend-dns.ps1
Set-Location C:\Projects\hawkesgenwebsite
py -I cloud\dns.py set resend._domainkey.hawkesgen.com TXT "p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC3CsYE2fBa5I6hBit66WY30fh0urIevB447V/+rW6QxBVJxgHkbrdZbLY1lTa2L8r9VlRnmZW0UoGD6z8bIBXAtA7H1kBlQO/i+aPPrBaL0sHAmnfCQd6FyuWwMcnaKP79GTYtzm2HEIqL3NXR18+Uyt83wjOfqszDUwV9ZspNQwIDAQAB"
py -I cloud\dns.py set rsend.hawkesgen.com CNAME rsend.forge.rmta.net
py -I cloud\dns.py set send.hawkesgen.com CNAME send.forge.rmta.net
py -I cloud\dns.py set _dmarc.hawkesgen.com TXT "v=DMARC1; p=none;"
Write-Host "Done. In Resend, press Verify on hawkesgen.com (it can take a few minutes)." -ForegroundColor Green
