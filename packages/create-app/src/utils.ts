import { execSync } from 'node:child_process';
import fs from 'fs-extra';
import path from 'node:path';
import os from 'node:os';

export async function fetchGitHubFolder(
  repoUrl: string,
  folderPath: string,
  targetPath: string,
): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `lynx-template-${Date.now()}`);
  await fs.ensureDir(tempDir);

  try {
    execSync(`git init "${tempDir}"`, { stdio: 'ignore' });

    execSync(`git -C "${tempDir}" remote add origin "${repoUrl}"`, {
      stdio: 'ignore',
    });

    execSync(`git -C "${tempDir}" sparse-checkout set "${folderPath}"`, {
      stdio: 'ignore',
    });

    execSync(`git -C "${tempDir}" pull origin feat/tailwind`, {
      stdio: 'ignore',
    });

    const sourcePath = path.join(tempDir, folderPath);
    await fs.copy(sourcePath, targetPath, { overwrite: true });
  } finally {
    await fs.remove(tempDir);
  }
}

export async function fetchAndMergeTemplate(
  repoUrl: string,
  folderPath: string,
  targetPath: string,
): Promise<void> {
  await fetchGitHubFolder(repoUrl, folderPath, targetPath);
}
