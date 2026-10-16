# Verifying releases

Every Plex Director image is built and published by the `publish` job of the
[`ci.yml`](../.github/workflows/ci.yml) workflow, on each push to `main` and each `v*.*.*` version tag. You can
check that the image you run came from that workflow, unchanged:

- the **images** on Docker Hub and GHCR are signed with [cosign](https://docs.sigstore.dev/) "keylessly": the
  signature is tied to the workflow's GitHub identity through [Sigstore](https://www.sigstore.dev/), so there
  is no long-lived signing key to steal, and every signature is recorded in the public Rekor transparency log;
- each image also carries the **build provenance** that Docker BuildKit records (which Dockerfile, which
  commit), as an attestation inside the image index, and images built after 1.1.0 also carry an **SBOM**
  (software bill of materials) the same way ([below](#sbom-and-build-provenance)).

You need [cosign](https://docs.sigstore.dev/cosign/system_config/installation/). The commands below were
checked with cosign 3.1.3. The signatures are stored in cosign's original (non-bundle) format, which cosign 2.x
reads as well, though that hasn't been tested here.

Use a release (1.2.0 or later) if you pin versions, or `latest` to follow `main`. Both kinds are covered below.

## Which identity signs what

The signing certificate names the workflow file and the git ref that started the run, and is issued by
GitHub Actions:

| Image | Certificate identity | OIDC issuer |
| :--- | :--- | :--- |
| A release, such as `1.4.0` or `1.4` | `https://github.com/HoneyBearTech/plex-director-mcp/.github/workflows/ci.yml@refs/tags/v1.4.0` | `https://token.actions.githubusercontent.com` |
| `latest` and `sha-<commit>` builds | `https://github.com/HoneyBearTech/plex-director-mcp/.github/workflows/ci.yml@refs/heads/main` | `https://token.actions.githubusercontent.com` |

Only pushes sign. Pull-request builds are never published.

## Verify a release image

```sh
cosign verify honeybeartech/plex-director-mcp:1.4.0 \
  --certificate-identity 'https://github.com/HoneyBearTech/plex-director-mcp/.github/workflows/ci.yml@refs/tags/v1.4.0' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

For the GHCR copy, use `ghcr.io/honeybeartech/plex-director-mcp:1.4.0` with the same flags. cosign lists the
checks it made and prints the signature's claims as JSON. Among them you should see the repository
(`HoneyBearTech/plex-director-mcp`), the ref (`refs/tags/v1.4.0`), the commit it was built from, and the
digest of the image index that was signed.

To check those claims as part of the command rather than by reading them, add:

```sh
  --certificate-github-workflow-repository HoneyBearTech/plex-director-mcp \
  --certificate-github-workflow-ref refs/tags/v1.4.0 \
  --certificate-github-workflow-trigger push
```

To accept any release rather than naming one, match the identity with a regular expression. Anchor it, and
escape the dots, so that nothing else can match:

```sh
cosign verify honeybeartech/plex-director-mcp:1.1 \
  --certificate-identity-regexp '^https://github\.com/HoneyBearTech/plex-director-mcp/\.github/workflows/ci\.yml@refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

## Verify a `latest` or `sha-` image

```sh
cosign verify honeybeartech/plex-director-mcp:latest \
  --certificate-identity 'https://github.com/HoneyBearTech/plex-director-mcp/.github/workflows/ci.yml@refs/heads/main' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same works for a `sha-` tag, such as `honeybeartech/plex-director-mcp:sha-d2bca8a`. To check that the image
was built from a particular commit, add `--certificate-github-workflow-sha` with the full commit hash.

## Pin the digest

A tag such as `1.1.0` or `sha-d2bca8a` can be moved by anyone who can push to the registry. A digest can't: it
is the hash of the image itself. To pin one (the example uses 1.1.0; for a `latest` or `sha-` build, inspect
that tag and verify with the `refs/heads/main` identity):

1. Find the digest of the multi-architecture image index:

   ```sh
   docker buildx imagetools inspect honeybeartech/plex-director-mcp:1.1.0
   ```

   The `Digest:` line near the top is the one to use. For 1.1.0 it is
   `sha256:cd5c5dbf01ef0f58456891a3832208408866d7ae4f9f20347d3d236d3d303f8f`, the same on Docker Hub and GHCR.
   (The per-platform digests listed under `Manifests:` are for one architecture each; pin the index digest so
   that the same line works on amd64 and arm64.)

2. Verify that digest, as above:

   ```sh
   cosign verify honeybeartech/plex-director-mcp@sha256:cd5c5dbf01ef0f58456891a3832208408866d7ae4f9f20347d3d236d3d303f8f \
     --certificate-identity 'https://github.com/HoneyBearTech/plex-director-mcp/.github/workflows/ci.yml@refs/tags/v1.1.0' \
     --certificate-oidc-issuer https://token.actions.githubusercontent.com
   ```

3. Use it in `compose.yaml`. Keeping the tag in front makes it readable; Docker then uses only the digest:

   ```yaml
   image: honeybeartech/plex-director-mcp:1.1.0@sha256:cd5c5dbf01ef0f58456891a3832208408866d7ae4f9f20347d3d236d3d303f8f
   ```

To see which digest a running container uses: `docker inspect --format '{{.Image}}' plex-director` gives the
local image ID, and `docker image inspect --format '{{join .RepoDigests "\n"}}' honeybeartech/plex-director-mcp:1.1.0`
the registry digest it was pulled by.

## SBOM and build provenance

```sh
docker buildx imagetools inspect honeybeartech/plex-director-mcp:1.1.0 --format '{{ json .Provenance }}'
docker buildx imagetools inspect honeybeartech/plex-director-mcp:latest --format '{{ json .SBOM }}'
```

The provenance shows, per platform, the Dockerfile and build arguments, and the image labels that name the
source repository and the commit (`org.opencontainers.image.revision`). The SBOM is an SPDX list of the packages
in the image, Node modules and the base image's packages alike.

- **Builds published since SBOM generation was added to the CI workflow** (October 2026), releases and
  `latest` alike, have an SBOM and full (`mode=max`) provenance.
- **Earlier builds**, including 1.1.0 and the `latest` and `sha-` builds before that change, have minimal
  provenance and **no SBOM**: the SBOM command prints `{}`.

Both are attached by BuildKit as attestation manifests listed in the image index, so the cosign signature on the
index digest covers them; they aren't signed separately.

## Not available yet

These are **planned**, not done. Until they are, the image signature above is the check to rely on.

- **Release files with checksums.** GitHub Releases have generated release notes and, after 1.1.0, a copy of
  the licence; there are no downloads, `SHA256SUMS` or signed provenance files to check.
- **Signed git tags for older releases.** From `v1.2.0`, release tags are signed (SSH; GitHub shows them as
  Verified). The `v1.1.0` tag is annotated but not signed, and `v1.0.0` is a plain tag.
- **A signature on 1.0.0.** cosign finds no signature for the `1.0.0` image (checked 15 October 2026). Use
  1.1.0 or later.

## If a check fails

Don't run that image. Pull it again by tag or digest, and check again; if it still fails, report it privately
as a security issue ([SECURITY.md](../SECURITY.md)).
