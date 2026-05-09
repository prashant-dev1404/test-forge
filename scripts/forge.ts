// scripts/forge.ts
// CLI entrypoint. Usage:
//   npx ts-node scripts/forge.ts --target /path/to/payout-engine --base-url http://localhost:8000

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as path from 'path';
import { crawl } from '../src/crawler/index';
import { generate } from '../src/generator/index';
import { writeReport } from '../src/generator/writer';

const program = new Command();

program
  .name('forge')
  .description('AI-powered test harness — reads your codebase, generates tests via Claude')
  .version('0.1.0')
  .requiredOption('-t, --target <path>', 'Path to the target repo to test')
  .option('-f, --framework <framework>', 'Framework: django | express | fastapi | auto', 'auto')
  .option('-b, --base-url <url>', 'Base URL of the running server', 'http://localhost:8000')
  .option('-o, --output <path>', 'Output directory for generated tests', '.')
  .parse(process.argv);

const opts = program.opts();

async function main() {
  console.log(chalk.bold('\n⚡ test-forge'));
  console.log(chalk.gray('AI-powered test generation via Claude\n'));

  const targetPath = path.resolve(opts.target);
  const outputDir = path.resolve(opts.output);

  // Step 1: Crawl
  const crawlSpinner = ora('Crawling target repo...').start();
  let apiMap;
  try {
    apiMap = await crawl({
      repoPath: targetPath,
      framework: opts.framework,
      baseUrl: opts.baseUrl,
    });
    crawlSpinner.succeed(
      `Crawled ${chalk.bold(apiMap.projectName)} — found ${chalk.bold(apiMap.routes.length)} routes, ${chalk.bold(apiMap.models.length)} models`
    );
  } catch (err) {
    crawlSpinner.fail(`Crawl failed: ${err}`);
    process.exit(1);
  }

  // Print what we found
  console.log(chalk.gray('\nRoutes discovered:'));
  for (const route of apiMap.routes) {
    const authTag = route.requiresAuth ? chalk.yellow('[auth]') : chalk.green('[public]');
    console.log(`  ${chalk.bold(route.method.padEnd(6))} ${route.path} ${authTag}`);
  }

  // Step 2: Generate
  console.log('');
  let result;
  try {
    result = await generate(apiMap, outputDir);
  } catch (err) {
    console.error(chalk.red(`\nGeneration failed: ${err}`));
    process.exit(1);
  }

  // Step 3: Write report
  const report = {
    apiMap,
    generatedFiles: {
      api: result.supertestFiles,
      e2e: result.playwrightFiles,
    },
    strategy: result.summary,
    generatedAt: new Date().toISOString(),
  };
  const reportPath = writeReport(outputDir, report);

  // Summary
  console.log(chalk.bold('\n✅ Done!\n'));
  console.log(`  API tests:       ${chalk.green(result.supertestFiles.length + ' files')}`);
  console.log(`  E2E tests:       ${chalk.green(result.playwrightFiles.length + ' files')}`);
  console.log(`  Report:          ${chalk.gray(reportPath)}`);

  if (result.summary.securityConcerns.length > 0) {
    console.log(chalk.yellow(`\n⚠️  Security concerns found:`));
    for (const concern of result.summary.securityConcerns) {
      console.log(chalk.yellow(`  ${concern.endpoint}: ${concern.concern}`));
    }
  }

  console.log(chalk.gray('\nReview generated tests before committing. Run: npm test\n'));
}

main().catch(err => {
  console.error(chalk.red('Unexpected error:'), err);
  process.exit(1);
});
