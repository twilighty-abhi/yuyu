# Yuyu Helm chart

Use this chart only on Kubernetes. For a single VPS or another container host
without Kubernetes, use the
[production Docker deployment guide](../../docs/DEPLOYMENT_DOCKER.md) instead.

## Images

Publish two images from the same commit and use immutable tags:

```bash
docker build --target migrator -t registry.example.com/yuyu-migrator:VERSION .
docker build --target runner \
  --build-arg NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY" \
  -t registry.example.com/yuyu:VERSION .
```

The Server Actions key is required by the application build, not the migrator
build. It must be present at application runtime with the same stable value.

## Runtime secret

Create the namespace and a Kubernetes Secret outside Helm. It must include every production value required by `.env.example` / `npm run production:check`.

```bash
kubectl create namespace yuyu
kubectl -n yuyu create secret generic yuyu-runtime --from-env-file=/secure/path/yuyu.env
```

Use External Secrets or Sealed Secrets in a real production cluster; do not commit the secret manifest.

## Install

Create a `values-production.yaml` outside source control:

```yaml
image:
  repository: registry.example.com/yuyu
  tag: "VERSION"
migration:
  image:
    repository: registry.example.com/yuyu-migrator
    tag: "VERSION"
ingress:
  enabled: true
  className: nginx
  hosts:
    - host: events.dev.idliapps.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: events-dev-idliapps-com-tls
      hosts: [events.dev.idliapps.com]
```

Validate and deploy:

```bash
helm lint charts/yuyu
helm upgrade --install yuyu charts/yuyu --namespace yuyu --create-namespace --values /secure/path/values-production.yaml --wait --timeout 10m
```

The migration Job is a Helm pre-install/pre-upgrade hook. A failed migration blocks the application rollout.
