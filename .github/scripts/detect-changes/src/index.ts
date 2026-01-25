#!/usr/bin/env node
/**
 * Main entry point for detect-changes tool.
 *
 * This tool analyzes Docker-based projects to detect:
 * - Changed base images and services
 * - Dependencies between images
 * - Which images need building vs retagging
 * - Services with tests and healthchecks
 */

import { Command } from 'commander';

const program = new Command();

program
  .name('detect-changes')
  .description('Detect Docker image changes and dependencies')
  .version('1.0.0');

program
  .command('detect')
  .description('Detect changed images and affected services')
  .option('-b, --base-ref <ref>', 'Base git reference to compare against', 'origin/master')
  .option('-s, --sha <sha>', 'Git SHA to use for image tags')
  .option('--fork', 'Running in a fork PR (cannot build base images)')
  .action((options) => {
    console.log('Detect command - to be implemented');
    console.log('Options:', options);
    process.exit(1);
  });

program.parse();
