---
name: ssl-certbot-domains
description: How to add a new domain to the existing certbot SSL certificate for this project
metadata:
  type: reference
---

## Adding SSL for a new subdomain/service

This project uses **certbot** on the server (`server-1966`) with the **nginx plugin** for automatic SSL management.

### Current certificate

The cert named `musicsync.kiw.ro` covers these domains (as of 2026-07-14):
- `musicsync.kiw.ro` — Next.js app
- `pb.musicsync.kiw.ro` — PocketBase admin
- `spoty.kiw.ro` — Navidrome

Certificate path: `/etc/letsencrypt/live/musicsync.kiw.ro/`

### Adding a new domain

When adding a new service (e.g., a new subdomain), expand the existing cert:

```bash
sudo certbot --nginx -d musicsync.kiw.ro -d pb.musicsync.kiw.ro -d spoty.kiw.ro -d <new-domain> --expand
```

- List ALL existing domains plus the new one — certbot replaces the SAN list, so omitting one removes it.
- The `--nginx` plugin handles the HTTP-01 challenge automatically by modifying nginx config temporarily.
- Then reload: `sudo nginx -t && sudo systemctl reload nginx`

### Alternative: webroot method

If `--nginx` isn't desired (e.g., to avoid config changes), use webroot — but first ensure the directory exists:

```bash
sudo mkdir -p /var/www/certbot
sudo certbot certonly --webroot -w /var/www/certbot -d <domain1> -d <domain2> ... --expand
```

### Verification

```bash
sudo certbot certificates          # list all certs and covered domains
sudo certbot renew --dry-run       # test auto-renewal works
```

**Why:** All project subdomains share one certificate for simplicity. Expanding with `--nginx` is the path of least resistance since the nginx config already exists and the plugin was used initially.
**How to apply:** When adding a new Docker service that needs its own subdomain, add an nginx server block in `nginx-musicsync.conf`, then run the expand command above to add the new domain to the cert.
