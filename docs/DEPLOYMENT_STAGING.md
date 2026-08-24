# Isolated staging deployment

This guide describes the disposable staging/test deployment at
`https://events.dev.idliapps.com`. The application and all backing services run
on the same VM under Docker Compose; Nginx remains installed directly on the
Ubuntu host as the TLS reverse proxy.

It is deliberately **not** a real production topology. The staging template
sets `CI=true` and `ALLOW_INSECURE_PRODUCTION_TESTS=1`, allowing non-TLS
PostgreSQL, Redis, and MinIO traffic on the private Docker network. Never use
those values for production or real user data.

## Server layout

The repository is deployed at:

```text
/opt/yuyu-staging/app
```

Copy the template and put real staging-only secrets in the ignored file:

```bash
cd /opt/yuyu-staging/app
cp .env.staging.example .env.staging
chmod 600 .env.staging
```

`POSTGRES_PASSWORD` must match the password embedded in `DATABASE_URL`, and
`REDIS_PASSWORD` must match the password embedded in `REDIS_URL`. Generate the
three encryption/authentication keys as documented in [Configuration](CONFIGURATION.md).

## First deployment

Start infrastructure services:

```bash
docker compose --env-file .env.staging -f compose.staging.yml up -d postgres redis minio mailpit
```

Initialize the private MinIO bucket:

```bash
docker compose --env-file .env.staging -f compose.staging.yml up minio-init
```

Run database migrations:

```bash
docker compose --env-file .env.staging -f compose.staging.yml run --rm migrate
```

Build the application image:

```bash
docker compose --env-file .env.staging -f compose.staging.yml build app
```

Start or recreate the application:

```bash
docker compose --env-file .env.staging -f compose.staging.yml up -d app
```

Check status:

```bash
docker compose --env-file .env.staging -f compose.staging.yml ps
```

The expected result of both checks is HTTP 200:

```bash
curl -I http://127.0.0.1:3001/api/health
curl -I https://events.dev.idliapps.com/api/health
```

PostgreSQL, Redis, and MinIO intentionally have no host ports. Mailpit's UI is
bound only to `127.0.0.1:8025`; access it through an SSH tunnel when needed.

## Nginx on the host

Nginx is not a Docker service. Its TLS virtual host must proxy the public
staging hostname to the loopback-only application port:

```nginx
server {
    listen 443 ssl http2;
    server_name events.dev.idliapps.com;

    # ssl_certificate and ssl_certificate_key are managed by Certbot.

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Validate and reload any Nginx change:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## Subsequent deployments

Take a database backup before migrations, then pull, build, migrate, and
recreate the application:

```bash
cd /opt/yuyu-staging/app
git pull --ff-only
docker compose --env-file .env.staging -f compose.staging.yml build app migrate
docker compose --env-file .env.staging -f compose.staging.yml run --rm migrate
docker compose --env-file .env.staging -f compose.staging.yml up -d app
docker compose --env-file .env.staging -f compose.staging.yml ps
```
