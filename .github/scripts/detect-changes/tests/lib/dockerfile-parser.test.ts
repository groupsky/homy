/**
 * Test suite for dockerfile-parser module.
 *
 * This test suite follows Test-Driven Development (TDD) principles and defines expected behavior
 * for the dockerfile-parser module BEFORE implementation. All tests will initially FAIL (red phase)
 * until the implementation is complete.
 *
 * The dockerfile-parser module is responsible for:
 * 1. Parsing multi-stage Dockerfiles and extracting base images
 * 2. Detecting HEALTHCHECK instructions and parameters
 * 3. Validating Dockerfile patterns (e.g., no ARG in FROM)
 * 4. Extracting external images from COPY --from statements
 * 5. Parsing base image Dockerfiles to extract upstream images and versions
 */

import { describe, test, expect } from '@jest/globals';
import {
  parseFromLines,
  extractFinalStageBase,
  hasHealthcheck,
  parseHealthcheckParams,
  extractCopyFromExternal,
  validateNoArgInFrom,
  parseBaseDockerfile,
  ValidationError,
} from '../../src/lib/dockerfile-parser.js';

describe('TestParseMultiStageDockerfile', () => {
  describe('test_single_stage_dockerfile', () => {
    test('Should extract base image from single-stage Dockerfile', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .
CMD ["node", "index.js"]
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
      expect(result[0].stage).toBeNull();
    });
  });

  describe('test_multi_stage_dockerfile', () => {
    test('Should extract all FROM lines from multi-stage build', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS build

RUN npm ci --omit=dev

FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
COPY . .
CMD ["node", "index.js"]
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(3);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
      expect(result[0].stage).toBe('base');
      expect(result[1].image).toBe('base');
      expect(result[1].stage).toBe('build');
      expect(result[2].image).toBe('base');
      expect(result[2].stage).toBe('RELEASE');
    });
  });

  describe('test_dockerfile_with_comments', () => {
    test('Should ignore comments when parsing FROM lines', () => {
      const dockerfileContent = `
# This is a comment
# FROM commented:out

FROM ghcr.io/groupsky/homy/alpine:3.22.1 AS base

# Another comment
RUN apk add --no-cache curl
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/alpine:3.22.1');
    });
  });

  describe('test_dockerfile_with_platform_specification', () => {
    test('Should handle FROM lines with --platform flag', () => {
      const dockerfileContent = `
FROM --platform=linux/amd64 ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
      expect(result[0].stage).toBe('base');
      expect(result[0].platform).toBe('linux/amd64');
    });
  });
});

describe('TestExtractFinalStageBase', () => {
  describe('test_single_stage_returns_that_image', () => {
    test('Should return the base image from single-stage Dockerfile', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/grafana:9.5.21

COPY grafana.ini /etc/grafana/grafana.ini
`;

      const result = extractFinalStageBase(dockerfileContent);

      expect(result).toBe('ghcr.io/groupsky/homy/grafana:9.5.21');
    });
  });

  describe('test_multi_stage_returns_last_external_image', () => {
    test('Should return the base image from the final stage in multi-stage build', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app

FROM base AS build

RUN npm ci

FROM base AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
`;

      const result = extractFinalStageBase(dockerfileContent);

      // Final stage is RELEASE which uses "base" (internal stage)
      // So the final external base is from the "base" stage
      expect(result).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
    });
  });

  describe('test_resolves_internal_stage_references', () => {
    test('Should follow internal stage references to find the ultimate external base', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/alpine:3.22.1 AS stage1

FROM stage1 AS stage2

FROM stage2 AS stage3

FROM stage3 AS final
`;

      const result = extractFinalStageBase(dockerfileContent);

      // All stages chain back to the alpine image
      expect(result).toBe('ghcr.io/groupsky/homy/alpine:3.22.1');
    });
  });
});

describe('TestDetectHealthcheckPresence', () => {
  describe('test_dockerfile_with_healthcheck', () => {
    test('Should return True if HEALTHCHECK exists in final stage', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node health-check.js

CMD ["node", "index.js"]
`;

      expect(hasHealthcheck(dockerfileContent)).toBe(true);
    });
  });

  describe('test_dockerfile_without_healthcheck', () => {
    test('Should return False if no HEALTHCHECK exists', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app
COPY . .

CMD ["node", "index.js"]
`;

      expect(hasHealthcheck(dockerfileContent)).toBe(false);
    });
  });

  describe('test_healthcheck_in_non_final_stage_ignored', () => {
    test('Should only detect HEALTHCHECK in the final stage', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

HEALTHCHECK CMD echo "healthy"

FROM base AS RELEASE

# No healthcheck in final stage
CMD ["node", "index.js"]
`;

      // Only final stage matters - this should return False
      expect(hasHealthcheck(dockerfileContent)).toBe(false);
    });
  });

  describe('test_healthcheck_disabled', () => {
    test('Should detect HEALTHCHECK NONE as explicitly disabled', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/grafana:9.5.21

HEALTHCHECK NONE

CMD ["grafana-server"]
`;

      const result = hasHealthcheck(dockerfileContent);

      // HEALTHCHECK NONE explicitly disables health checks
      expect(result).toBe(false);
    });
  });
});

describe('TestParseHealthcheckParameters', () => {
  describe('test_healthcheck_with_all_parameters', () => {
    test('Should extract all 4 parameters: interval, timeout, start-period, retries', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node health-check.js
`;

      const result = parseHealthcheckParams(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.interval).toBe('30s');
      expect(result!.timeout).toBe('10s');
      expect(result!.start_period).toBe('5s');
      expect(result!.retries).toBe('3');
      expect(result!.cmd).toBe('node health-check.js');
    });
  });

  describe('test_healthcheck_with_missing_parameters', () => {
    test('Should handle missing optional parameters with defaults', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/mosquitto:2.0

HEALTHCHECK --interval=30s --timeout=5s --retries=6 \\
  CMD mosquitto_sub -t '$$SYS/#' -C 1 | grep -q version
`;

      const result = parseHealthcheckParams(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.interval).toBe('30s');
      expect(result!.timeout).toBe('5s');
      expect(result!.retries).toBe('6');
      // start_period should use default or be null
      expect([null, '0s']).toContain(result!.start_period);
    });
  });

  describe('test_healthcheck_minimal_format', () => {
    test('Should parse minimal HEALTHCHECK without optional parameters', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/homeassistant:latest

HEALTHCHECK CMD curl --fail http://localhost:8123/ || exit 1
`;

      const result = parseHealthcheckParams(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.cmd).toBe('curl --fail http://localhost:8123/ || exit 1');
      // Should have defaults for missing parameters
      expect(result).toHaveProperty('interval');
      expect(result).toHaveProperty('timeout');
    });
  });

  describe('test_no_healthcheck_returns_none', () => {
    test('Should return null when no HEALTHCHECK exists', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

CMD ["node", "index.js"]
`;

      const result = parseHealthcheckParams(dockerfileContent);

      expect(result).toBeNull();
    });
  });
});

describe('TestDetectCopyFromExternal', () => {
  describe('test_copy_from_with_external_image', () => {
    test('Should extract external images from COPY --from=image:tag', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/alpine:3.22.1

COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/bin/node /usr/local/bin/

CMD ["node", "--version"]
`;

      const result = extractCopyFromExternal(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result).toContain('ghcr.io/groupsky/homy/node:18.20.8-alpine');
    });
  });

  describe('test_copy_from_internal_stage_ignored', () => {
    test('Should not include internal stage names in COPY --from', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS build

RUN npm ci

FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS RELEASE

COPY --from=build /usr/src/app/node_modules ./node_modules
`;

      const result = extractCopyFromExternal(dockerfileContent);

      // "build" is an internal stage, should not be in results
      expect(result).toHaveLength(0);
    });
  });

  describe('test_multiple_copy_from_external', () => {
    test('Should extract multiple unique external images', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/alpine:3.22.1

COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/bin/node /usr/local/bin/
COPY --from=ghcr.io/groupsky/homy/python:3.11-alpine /usr/local/bin/python /usr/local/bin/
COPY --from=ghcr.io/groupsky/homy/node:18.20.8-alpine /usr/local/lib/node_modules /usr/local/lib/
`;

      const result = extractCopyFromExternal(dockerfileContent);

      // Should deduplicate the node image
      expect(result).toHaveLength(2);
      expect(result).toContain('ghcr.io/groupsky/homy/node:18.20.8-alpine');
      expect(result).toContain('ghcr.io/groupsky/homy/python:3.11-alpine');
    });
  });

  describe('test_copy_without_from_ignored', () => {
    test('Should ignore COPY statements without --from flag', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

COPY package*.json ./
COPY . .
`;

      const result = extractCopyFromExternal(dockerfileContent);

      expect(result).toHaveLength(0);
    });
  });
});

describe('TestValidateNoArgInFrom', () => {
  describe('test_from_with_fixed_tags_passes', () => {
    test('Should pass when FROM uses fixed image tags', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

WORKDIR /usr/src/app
`;

      // Should not throw ValidationError
      expect(() => validateNoArgInFrom(dockerfileContent)).not.toThrow();
    });
  });

  describe('test_from_with_arg_variable_fails', () => {
    test('Should raise ValidationError when ARG variable in FROM', () => {
      const dockerfileContent = `
ARG NODE_VERSION=18.20.8

FROM ghcr.io/groupsky/homy/node:\${NODE_VERSION}-alpine AS base

WORKDIR /usr/src/app
`;

      expect(() => validateNoArgInFrom(dockerfileContent)).toThrow(ValidationError);
      expect(() => validateNoArgInFrom(dockerfileContent)).toThrow(/ARG/);
      expect(() => validateNoArgInFrom(dockerfileContent)).toThrow(/FROM/);
    });
  });

  describe('test_from_with_dollar_sign_in_image_name_fails', () => {
    test('Should detect variable substitution patterns in FROM', () => {
      const dockerfileContent = `
FROM node:$VERSION

WORKDIR /app
`;

      expect(() => validateNoArgInFrom(dockerfileContent)).toThrow(ValidationError);
      expect(() => validateNoArgInFrom(dockerfileContent)).toThrow(/variable|ARG/i);
    });
  });

  describe('test_arg_used_elsewhere_is_allowed', () => {
    test('Should allow ARG when not used in FROM line', () => {
      const dockerfileContent = `
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

ARG BUILD_DATE
LABEL build_date=\${BUILD_DATE}

WORKDIR /usr/src/app
`;

      // Should not throw ValidationError
      expect(() => validateNoArgInFrom(dockerfileContent)).not.toThrow();
    });
  });
});

describe('TestParseBaseImageDockerfile', () => {
  describe('test_simple_base_image_dockerfile', () => {
    test('Should extract upstream image from base image Dockerfile', () => {
      // This is the typical pattern for base-images/ directory
      const dockerfileContent = `
FROM node:18.20.8-alpine3.21
`;

      const result = parseBaseDockerfile(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('node:18.20.8-alpine3.21');
      expect(result!.image_name).toBe('node');
      expect(result!.version_tag).toBe('18.20.8-alpine3.21');
    });
  });

  describe('test_base_image_with_registry', () => {
    test('Should handle upstream images with registry prefix', () => {
      const dockerfileContent = `
FROM docker.io/grafana/grafana:9.5.21
`;

      const result = parseBaseDockerfile(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('docker.io/grafana/grafana:9.5.21');
      expect(result!.image_name).toBe('grafana/grafana');
      expect(result!.version_tag).toBe('9.5.21');
    });
  });

  describe('test_base_image_without_version_tag', () => {
    test('Should handle images without explicit version tag', () => {
      const dockerfileContent = `
FROM alpine
`;

      const result = parseBaseDockerfile(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('alpine');
      expect(result!.image_name).toBe('alpine');
      // Version tag should be null or 'latest'
      expect([null, 'latest']).toContain(result!.version_tag);
    });
  });

  describe('test_multi_stage_base_image_uses_first_from', () => {
    test('Should extract from first FROM line in multi-stage base image', () => {
      const dockerfileContent = `
FROM influxdb:1.8.10 AS base

RUN apt-get update

FROM base AS final

HEALTHCHECK --interval=1s --timeout=1s --retries=3 \\
  CMD influx -execute 'SHOW DATABASES'
`;

      const result = parseBaseDockerfile(dockerfileContent);

      // Should use the first external FROM
      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('influxdb:1.8.10');
      expect(result!.image_name).toBe('influxdb');
      expect(result!.version_tag).toBe('1.8.10');
    });
  });
});

describe('TestDockerfileParserEdgeCases', () => {
  describe('test_empty_dockerfile_content', () => {
    test('Should handle empty Dockerfile content gracefully', () => {
      const result = parseFromLines('');

      expect(result).toEqual([]);
    });
  });

  describe('test_dockerfile_with_only_comments', () => {
    test('Should handle Dockerfile with only comments', () => {
      const dockerfileContent = `
# Comment 1
# Comment 2
# Comment 3
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toEqual([]);
    });
  });

  describe('test_malformed_from_line', () => {
    test('Should handle malformed FROM lines gracefully', () => {
      const dockerfileContent = `
FROM
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine
`;

      // Should skip malformed line and parse valid one
      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
    });
  });

  describe('test_dockerfile_with_windows_line_endings', () => {
    test('Should handle Windows-style line endings (CRLF)', () => {
      const dockerfileContent = 'FROM ghcr.io/groupsky/homy/alpine:3.22.1\r\nWORKDIR /app\r\n';

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/alpine:3.22.1');
    });
  });

  describe('test_case_insensitive_from_parsing', () => {
    test('Should handle lowercase "from" instruction', () => {
      const dockerfileContent = `
from ghcr.io/groupsky/homy/node:18.20.8-alpine as base
`;

      const result = parseFromLines(dockerfileContent);

      expect(result).toHaveLength(1);
      expect(result[0].image).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');
      expect(result[0].stage).toBe('base');
    });
  });
});

describe('TestDockerfileParserIntegration', () => {
  describe('test_parse_real_automations_dockerfile', () => {
    test('Should correctly parse the automations service Dockerfile', () => {
      const dockerfileContent = `#### Stage BASE ########################################################################################################
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base

# Install tools, create app dir, add user and set rights
RUN set -ex && \\
    mkdir -p /usr/src/app && \\
    deluser --remove-home node && \\
    adduser -h /usr/src/app -D -H node-app -u 1000 && \\
    addgroup node-app dialout && \\
    chown -R node-app:node-app /usr/src/app

# Set work directory
WORKDIR /usr/src/app

# copy package.json and lock file
COPY package*.json ./

#### Stage BUILD #######################################################################################################
FROM base AS build

# Install Build tools
RUN apk add --no-cache --virtual buildtools build-base linux-headers udev python3 && \\
    npm ci --unsafe-perm --no-update-notifier --omit=dev && \\
    cp -R node_modules prod_node_modules

#### Stage RELEASE #####################################################################################################
FROM base AS RELEASE

ENV NODE_OPTIONS="--unhandled-rejections=strict"

USER root

COPY --from=build /usr/src/app/prod_node_modules ./node_modules
COPY . .

# Chown & Clean up
RUN chown -R root:root /usr/src/app && \\
    rm -rf /tmp/*

USER node-app

ENTRYPOINT ["node", "index.js"]
`;

      // Parse all FROM lines
      const fromLines = parseFromLines(dockerfileContent);
      expect(fromLines).toHaveLength(3);
      expect(fromLines[0].stage).toBe('base');
      expect(fromLines[1].stage).toBe('build');
      expect(fromLines[2].stage).toBe('RELEASE');

      // Extract final stage base
      const finalBase = extractFinalStageBase(dockerfileContent);
      expect(finalBase).toBe('ghcr.io/groupsky/homy/node:18.20.8-alpine');

      // Check healthcheck
      expect(hasHealthcheck(dockerfileContent)).toBe(false);

      // Check COPY --from (should only find internal "build" stage, not external)
      const externalCopies = extractCopyFromExternal(dockerfileContent);
      expect(externalCopies).toHaveLength(0);

      // Validate no ARG in FROM
      expect(() => validateNoArgInFrom(dockerfileContent)).not.toThrow();
    });
  });

  describe('test_parse_real_telegram_bridge_dockerfile', () => {
    test('Should correctly parse the telegram-bridge service Dockerfile with HEALTHCHECK', () => {
      const dockerfileContent = `FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \\
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

EXPOSE 3000

CMD ["node", "index.js"]
`;

      // Parse FROM lines
      const fromLines = parseFromLines(dockerfileContent);
      expect(fromLines).toHaveLength(1);

      // Check healthcheck exists
      expect(hasHealthcheck(dockerfileContent)).toBe(true);

      // Parse healthcheck params
      const healthcheck = parseHealthcheckParams(dockerfileContent);
      expect(healthcheck).not.toBeNull();
      expect(healthcheck!.interval).toBe('30s');
      expect(healthcheck!.timeout).toBe('10s');
      expect(healthcheck!.start_period).toBe('5s');
      expect(healthcheck!.retries).toBe('3');
    });
  });

  describe('test_parse_base_image_node_dockerfile', () => {
    test('Should correctly parse base-images/node-18-alpine/Dockerfile', () => {
      const dockerfileContent = `FROM node:18.20.8-alpine3.21
`;

      const result = parseBaseDockerfile(dockerfileContent);

      expect(result).not.toBeNull();
      expect(result!.upstream_image).toBe('node:18.20.8-alpine3.21');
      expect(result!.image_name).toBe('node');
      expect(result!.version_tag).toBe('18.20.8-alpine3.21');
    });
  });
});
