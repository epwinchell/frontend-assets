/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');
const { glob } = require('glob');
const { generateSvgMetadata } = require('./metadata-generator');

const projectBase = path.resolve(__dirname, '..');
const iconsBase = path.resolve(projectBase, 'src');

// Define the specific directories to search for icons.
// This should match the configuration in generate-modules.js
const iconFolders = ['technology-icons', 'partners'];

/**
 * Find all SVG files in a directory
 * @param {string} dir - Directory to search
 * @returns {Promise<string[]>} Array of SVG file paths
 */
async function findAllSvgFiles(dir) {
  return await glob('**/*.svg', { cwd: dir, absolute: true });
}

/**
 * Generate the expected module federation entries based on current SVG files
 * @returns {Promise<Record<string, string>>} Expected module entries
 */
async function generateExpectedModuleEntries() {
  let svgFiles = [];

  // Only search in the specified icon folders
  for (const folder of iconFolders) {
    const searchDirectory = path.join(iconsBase, folder);
    const filesInFolder = await findAllSvgFiles(searchDirectory);
    svgFiles = svgFiles.concat(filesInFolder);
  }

  const expectedEntries = {};

  for (const file of svgFiles) {
    const metadata = generateSvgMetadata(file, iconsBase);
    const exposedModuleName = `./${metadata.name}`;
    // Use path.resolve for unambiguous path resolution from fec.config.js directory
    // Remove leading slash from sourceFilePath and add 'src' prefix
    const cleanPath = metadata.sourceFilePath.replace(/^\/+/, '');
    const exposedModulePath = `path.resolve(__dirname, 'src', '${cleanPath}')`;
    expectedEntries[exposedModuleName] = exposedModulePath;
  }

  // Sort the entries alphabetically for consistent comparison
  const sortedExpectedEntries = Object.keys(expectedEntries)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = expectedEntries[key];
      return sorted;
    }, {});

  return sortedExpectedEntries;
}

/**
 * Extract the current module federation config from fec.config.js
 * @returns {Record<string, string>} Current module entries
 */
function getCurrentModuleEntries() {
  const configPath = path.join(projectBase, 'fec.config.js');
  const configContent = fs.readFileSync(configPath, 'utf8');

  // Find the moduleFederation section
  if (!configContent.includes('moduleFederation:')) {
    return {};
  }

  // Find the start of moduleFederation
  const moduleFedStart = configContent.indexOf('moduleFederation:');

  // Find the exposes object
  const exposesStart = configContent.indexOf('exposes:', moduleFedStart);
  if (exposesStart === -1) {
    return {};
  }

  // Find the opening brace after exposes:
  let braceStart = configContent.indexOf('{', exposesStart);
  if (braceStart === -1) {
    return {};
  }

  // Find the matching closing brace
  let braceCount = 0;
  let braceEnd = braceStart;
  for (let i = braceStart; i < configContent.length; i++) {
    if (configContent[i] === '{') {
      braceCount++;
    } else if (configContent[i] === '}') {
      braceCount--;
      if (braceCount === 0) {
        braceEnd = i;
        break;
      }
    }
  }

  // Extract the exposes content
  const exposesContent = configContent.substring(braceStart + 1, braceEnd);

  // Parse the entries using regex to extract key-value pairs
  const entries = {};
  const entryRegex =
    /["']([^"']+)["']:\s*path\.resolve\(__dirname,\s*['"]src['"],\s*['"]([^'"]+)['"]\)/g;

  let match;
  while ((match = entryRegex.exec(exposesContent)) !== null) {
    const [, key, relativePath] = match;
    // Reconstruct the expected format for comparison
    entries[key] = `path.resolve(__dirname, 'src', '${relativePath}')`;
  }

  return entries;
}

/**
 * Compare two module entry objects
 * @param {Record<string, string>} current - Current entries
 * @param {Record<string, string>} expected - Expected entries
 * @returns {{isEqual: boolean, differences: Array}} Comparison result
 */
function compareModuleEntries(current, expected) {
  const differences = [];
  const currentKeys = Object.keys(current).sort();
  const expectedKeys = Object.keys(expected).sort();

  // Check for missing modules
  const missingModules = expectedKeys.filter(
    (key) => !currentKeys.includes(key),
  );
  if (missingModules.length > 0) {
    differences.push({
      type: 'missing',
      modules: missingModules,
      description: `Missing ${missingModules.length} module(s) in current config`,
    });
  }

  // Check for extra modules
  const extraModules = currentKeys.filter((key) => !expectedKeys.includes(key));
  if (extraModules.length > 0) {
    differences.push({
      type: 'extra',
      modules: extraModules,
      description: `Found ${extraModules.length} extra module(s) in current config`,
    });
  }

  // Check for path differences
  const pathDifferences = [];
  for (const key of expectedKeys) {
    if (current[key] && current[key] !== expected[key]) {
      pathDifferences.push({
        module: key,
        current: current[key],
        expected: expected[key],
      });
    }
  }

  if (pathDifferences.length > 0) {
    differences.push({
      type: 'path_mismatch',
      modules: pathDifferences,
      description: `Found ${pathDifferences.length} module(s) with incorrect paths`,
    });
  }

  return {
    isEqual: differences.length === 0,
    differences,
  };
}

/**
 * Generate a helpful error message for developers
 * @param {{isEqual: boolean, differences: Array}} comparison - Comparison result
 * @returns {string} Error message
 */
function generateErrorMessage(comparison) {
  let message = '\n❌ MODULE FEDERATION CONFIG VALIDATION FAILED\n\n';
  message +=
    'The module federation configuration in fec.config.js is out of sync with the current SVG files.\n\n';

  comparison.differences.forEach((diff, index) => {
    message += `${index + 1}. ${diff.description}:\n`;

    if (diff.type === 'missing' || diff.type === 'extra') {
      diff.modules.slice(0, 5).forEach((module) => {
        message += `   - ${module}\n`;
      });
      if (diff.modules.length > 5) {
        message += `   - ... and ${diff.modules.length - 5} more\n`;
      }
    } else if (diff.type === 'path_mismatch') {
      diff.modules.slice(0, 3).forEach(({ module, current, expected }) => {
        message += `   - ${module}:\n`;
        message += `     Current:  ${current}\n`;
        message += `     Expected: ${expected}\n`;
      });
      if (diff.modules.length > 3) {
        message += `   - ... and ${diff.modules.length - 3} more path mismatches\n`;
      }
    }
    message += '\n';
  });

  message += '🔧 HOW TO FIX:\n\n';
  message += '1. Run the generation script to update the configuration:\n';
  message += '   npm run generate-modules\n\n';
  message += '2. Commit the updated fec.config.js file:\n';
  message += '   git add fec.config.js\n';
  message += '   git commit -m "Update module federation config"\n\n';
  message +=
    '3. If you added/removed SVG files, make sure they are committed too:\n';
  message += '   git add src/\n';
  message += '   git commit -m "Add/remove SVG assets"\n\n';
  message +=
    'This ensures that the module federation configuration stays in sync with the available SVG assets.\n';

  return message;
}

/**
 * Main validation function
 * @returns {Promise<boolean>} True if validation passes, false otherwise
 */
async function validateConfig() {
  try {
    console.log('🔍 Validating module federation configuration...');

    const [currentEntries, expectedEntries] = await Promise.all([
      getCurrentModuleEntries(),
      generateExpectedModuleEntries(),
    ]);

    const comparison = compareModuleEntries(currentEntries, expectedEntries);

    if (comparison.isEqual) {
      console.log('✅ Module federation configuration is up-to-date!');
      console.log(
        `📊 Found ${Object.keys(expectedEntries).length} modules in sync.`,
      );
      return true;
    } else {
      console.error(generateErrorMessage(comparison));
      return false;
    }
  } catch (error) {
    console.error('❌ Error during validation:', error);
    return false;
  }
}

// Run validation if this script is executed directly
if (require.main === module) {
  validateConfig().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = {
  validateConfig,
  generateExpectedModuleEntries,
  getCurrentModuleEntries,
  compareModuleEntries,
};
