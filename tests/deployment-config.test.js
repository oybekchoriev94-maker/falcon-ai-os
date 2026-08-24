import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('production deployment contract', () => {
  it('keeps internal services behind Caddy', () => {
    const compose = read('docker-compose.yml');

    expect(compose).not.toContain('"3000:3000"');
    expect(compose).not.toContain('"3001:3001"');
    expect(compose).not.toContain('"8081:8081"');
    expect(compose).toContain('ports:\n      - "80:80"\n      - "443:443"');
  });

  it('deploys immutable backend, frontend and STT images', () => {
    const compose = read('docker-compose.yml');
    const workflow = read('.github/workflows/ci.yml');

    expect(compose).toContain('${BACKEND_IMAGE:-falcon-ai-os:local}');
    expect(compose).toContain('${FRONTEND_IMAGE:-falcon-ai-os-frontend:local}');
    expect(compose).toContain('${STT_IMAGE:-falcon-ai-os-stt:local}');
    expect(workflow).toContain('falcon-ai-os-stt:${{ github.sha }}');
    expect(workflow).toContain('export BACKEND_IMAGE=');
    expect(workflow).toContain('export FRONTEND_IMAGE=');
    expect(workflow).toContain('export STT_IMAGE=');
    expect(workflow).toContain('--no-build');
    expect(workflow).toContain('IMAGE_NAMESPACE: ghcr.io/${{ github.repository_owner }}');
    expect(workflow).toContain('packages: write');
    expect(workflow).toContain('password: ${{ secrets.GITHUB_TOKEN }}');
    expect(workflow).not.toContain('DOCKER_PASSWORD');
    expect(workflow).not.toContain('DOCKER_USERNAME');
  });

  it('waits for real service health before completing deploy', () => {
    const compose = read('docker-compose.yml');
    const workflow = read('.github/workflows/ci.yml');
    const backendHealthcheck = read('scripts/healthcheck.cjs');
    const frontendDockerfile = read('frontend/Dockerfile');

    expect(compose).toContain('condition: service_healthy');
    expect(workflow).toContain('--wait --wait-timeout 900');
    expect(backendHealthcheck).toContain("path: '/api/health/ready'");
    expect(frontendDockerfile).toContain('HEALTHCHECK');
  });
});
