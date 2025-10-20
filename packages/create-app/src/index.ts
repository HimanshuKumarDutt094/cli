#!/usr/bin/env node

import * as p from '@clack/prompts';
import { Command } from 'commander';
import { execSync } from 'child_process';
import fs from 'fs-extra';
import gradient from 'gradient-string';
import path from 'path';
import pc from 'picocolors';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function detectPackageManager(): string {
  const userAgent = process.env.npm_config_user_agent || '';

  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('bun')) return 'bun';

  const execPath = process.env.npm_execpath || '';
  if (execPath.includes('yarn')) return 'yarn';
  if (execPath.includes('pnpm')) return 'pnpm';
  if (execPath.includes('bun')) return 'bun';

  return 'npm';
}

interface AppConfig {
  name: string;
  platforms: string[];
  directory: string;
  useTailwind: boolean;
}

interface CLIOptions {
  platforms?: string[];
  directory?: string;
  useTailwind?: boolean;
}

function toPascalCase(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\s/g, '');
}

function toValidJavaPackageName(str: string): string {
  let packageName = str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^[0-9]+/, '');

  if (!packageName || !/^[a-z]/.test(packageName)) {
    packageName = `app${packageName}`;
  }

  return packageName;
}

async function replaceTemplateStrings(
  projectPath: string,
  projectName: string,
): Promise<void> {
  const pascalName = toPascalCase(projectName);
  const javaName = toValidJavaPackageName(projectName);

  const replacements = [
    [/HelloWorld/g, pascalName],
    [/helloworld/g, javaName],
    [/com\.helloworld/g, `com.${javaName}`],
    [/Theme\.HelloWorld/g, `Theme.${pascalName}`],
  ] as const;

  const files = (await getFilesRecursively(projectPath)).filter(isTextFile);

  await Promise.all(
    files.map(async (filePath) => {
      try {
        let content = await fs.readFile(filePath, 'utf8');
        let changed = false;

        for (const [pattern, replacement] of replacements) {
          if (pattern.test(content)) {
            content = content.replace(pattern, replacement);
            changed = true;
          }
        }

        if (changed) {
          await fs.writeFile(filePath, content, 'utf8');
        }
      } catch {
        // Skip files that can't be processed
      }
    }),
  );
}

async function getFilesRecursively(dir: string): Promise<string[]> {
  const files: string[] = [];
  const items = await fs.readdir(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      files.push(...(await getFilesRecursively(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function isTextFile(filePath: string): boolean {
  const binaryExts = [
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.jar',
    '.aar',
    '.so',
    '.dylib',
    '.dll',
    '.zip',
    '.tar',
    '.gz',
    '.mp3',
    '.mp4',
    '.pdf',
    '.keystore',
  ];
  return !binaryExts.includes(path.extname(filePath).toLowerCase());
}

async function renameTemplateFilesAndDirs(
  projectPath: string,
  projectName: string,
): Promise<void> {
  const pascalName = toPascalCase(projectName);
  const javaName = toValidJavaPackageName(projectName);

  await renameJavaPackageDirectories(projectPath, javaName);

  const items = (await getItemsToRename(projectPath)).sort(
    (a, b) => b.split(path.sep).length - a.split(path.sep).length,
  );

  for (const itemPath of items) {
    const newName = path.basename(itemPath).replace(/HelloWorld/g, pascalName);
    const newPath = path.join(path.dirname(itemPath), newName);

    if ((await fs.pathExists(itemPath)) && !(await fs.pathExists(newPath))) {
      await fs.move(itemPath, newPath);
    }
  }
}

async function renameJavaPackageDirectories(
  projectPath: string,
  packageName: string,
): Promise<void> {
  const javaPaths = [
    'android/app/src/main/java',
    'android/app/src/test/java',
    'android/app/src/androidTest/java',
  ];

  for (const javaPath of javaPaths) {
    const fullPath = path.join(projectPath, javaPath);
    if (await fs.pathExists(fullPath)) {
      await renamePackageInDirectory(fullPath, packageName);
    }
  }
}

async function renamePackageInDirectory(
  javaSourceDir: string,
  newPackageName: string,
): Promise<void> {
  const comPath = path.join(javaSourceDir, 'com');
  if (!(await fs.pathExists(comPath))) return;

  const oldPath = path.join(comPath, 'helloworld');
  const newPath = path.join(comPath, newPackageName);

  if ((await fs.pathExists(oldPath)) && !(await fs.pathExists(newPath))) {
    await fs.move(oldPath, newPath);
  }
}

async function getItemsToRename(dir: string): Promise<string[]> {
  const items: string[] = [];

  try {
    const dirItems = await fs.readdir(dir, { withFileTypes: true });

    for (const item of dirItems) {
      const fullPath = path.join(dir, item.name);
      items.push(fullPath);

      if (item.isDirectory()) {
        items.push(...(await getItemsToRename(fullPath)));
      }
    }
  } catch {
    // Skip unreadable directories
  }

  return items;
}

export async function createApp(): Promise<void> {
  const brandGradient = gradient(['#ff6b9d', '#45b7d1']);
  const title = pc.bold(`Create ${brandGradient('Lynx')} App`);

  p.intro(title);

  const program = new Command();

  program
    .name('create-lynx-app')
    .description('Create a new Lynx application')
    .version('0.1.0')
    .argument('[project-name]', 'Name of the project')
    .option('-p, --platforms <platforms...>', 'Platforms to include')
    .option('-t, --tailwind', 'Use Tailwind CSS')
    .option('-d, --directory <directory>', 'Target directory')
    .action(async (projectName?: string, options?: CLIOptions) => {
      try {
        const config = await gatherProjectInfo(projectName, options);
        await scaffoldProject(config);

        const packageManager = detectPackageManager();
        const installCmd =
          packageManager === 'yarn' ? 'yarn' : `${packageManager} install`;
        const devCmd = `${packageManager} dev`;

        p.outro(pc.cyan('Happy hacking!'));
        console.log(pc.white(`Next steps:`));
        console.log(pc.gray(`  cd ${config.name}`));
        console.log(pc.gray(`  ${installCmd}`));
        console.log(pc.gray(`  ${devCmd}`));
      } catch (error) {
        if (error instanceof Error && error.message === 'cancelled') {
          p.cancel('Operation cancelled.');
          process.exit(0);
        }
        p.cancel(pc.red('❌ Error creating project: ' + error));
        process.exit(1);
      }
    });

  await program.parseAsync();
}

async function gatherProjectInfo(
  projectName?: string,
  options?: CLIOptions,
): Promise<AppConfig> {
  let name = projectName;
  let platforms = options?.platforms;

  if (!name) {
    const nameResult = await p.text({
      message: 'What is your app named?',
      placeholder: 'my-lynx-app',
      validate: (value) => {
        if (!value.trim()) return 'App name is required';
        if (!/^[a-zA-Z0-9-_]+$/.test(value)) {
          return 'App name should only contain letters, numbers, hyphens, and underscores';
        }
      },
    });

    if (p.isCancel(nameResult)) {
      throw new Error('cancelled');
    }

    name = nameResult;
  }

  if (!platforms || platforms.length === 0) {
    const platformsResult = await p.multiselect({
      message: 'What platforms do you want to start with?',
      options: [
        { value: 'ios', label: 'iOS' },
        { value: 'android', label: 'Android' },
        // { value: 'harmonyos', label: 'HarmonyOS' },
      ],
      initialValues: ['ios', 'android'],
      required: true,
    });

    if (p.isCancel(platformsResult)) {
      throw new Error('cancelled');
    }

    platforms = platformsResult as string[];
  }

  let useTailwind = false;
  if (options?.useTailwind === true) {
    useTailwind = true;
  } else if (options?.useTailwind === false) {
    useTailwind = false;
  } else {
    const tailwindResult = await p.confirm({
      message: 'Do you want to use Tailwind CSS?',
      initialValue: false,
    });

    if (p.isCancel(tailwindResult)) {
      throw new Error('cancelled');
    }

    useTailwind = tailwindResult;
  }

  return {
    name: name as string,
    platforms: platforms as string[],
    directory: options?.directory || process.cwd(),
    useTailwind,
  };
}

async function scaffoldProject(config: AppConfig): Promise<void> {
  const targetPath = path.join(config.directory, config.name);
  const repoUrl = 'https://github.com/lynx-community/cli';

  const spinner = p.spinner();
  spinner.start(`Creating project in ${targetPath}`);

  // Create target directory
  await fs.ensureDir(targetPath);

  // Copy platform-specific folders from local helloworld package
  spinner.message('Adding platform-specific folders...');
  if (config.platforms.includes('android')) {
    const androidPath = path.join(__dirname, '../helloworld/android');
    if (await fs.pathExists(androidPath)) {
      await fs.copy(androidPath, path.join(targetPath, 'android'), {
        overwrite: true,
      });
    }
  }
  if (config.platforms.includes('ios')) {
    const iosPath = path.join(__dirname, '../helloworld/apple');
    if (await fs.pathExists(iosPath)) {
      await fs.copy(iosPath, path.join(targetPath, 'apple'), {
        overwrite: true,
      });
    }
  }

  // Fetch core React template
  spinner.message('Fetching React template...');
  await fetchGitHubFolder(repoUrl, 'packages/templates/react', targetPath);

  // Fetch and merge Tailwind template if selected
  if (config.useTailwind) {
    spinner.message('Adding Tailwind CSS...');
    await fetchAndMergeTemplate(
      repoUrl,
      'packages/templates/react-tailwind',
      targetPath,
    );
  }

  // Configure project files
  spinner.message('Configuring project files...');
  await replaceTemplateStrings(targetPath, config.name);
  await renameTemplateFilesAndDirs(targetPath, config.name);

  spinner.stop('Project created successfully!');
}

async function fetchGitHubFolder(
  repoUrl: string,
  folderPath: string,
  targetPath: string,
): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `lynx-template-${Date.now()}`);
  await fs.ensureDir(tempDir);

  try {
    // Initialize git repo
    execSync(`git init "${tempDir}"`, { stdio: 'ignore' });

    // Add remote
    execSync(`git -C "${tempDir}" remote add origin "${repoUrl}"`, {
      stdio: 'ignore',
    });

    // Configure sparse checkout
    execSync(`git -C "${tempDir}" sparse-checkout set "${folderPath}"`, {
      stdio: 'ignore',
    });

    // Pull the folder
    execSync(`git -C "${tempDir}" pull origin main`, { stdio: 'ignore' });

    // Copy the folder contents to target
    const sourcePath = path.join(tempDir, folderPath);
    await fs.copy(sourcePath, targetPath, { overwrite: true });
  } finally {
    // Clean up temp directory
    await fs.remove(tempDir);
  }
}

async function fetchAndMergeTemplate(
  repoUrl: string,
  folderPath: string,
  targetPath: string,
): Promise<void> {
  await fetchGitHubFolder(repoUrl, folderPath, targetPath);
}
