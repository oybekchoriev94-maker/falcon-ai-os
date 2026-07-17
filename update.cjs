const fs = require('fs');
const path = require('path');
const dir = 'c:/Projects/falcon-ai-os/public';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.html'));

for(let file of files) {
  let content = fs.readFileSync(path.join(dir, file), 'utf-8');
  
  // Replace tailwind script
  content = content.replace(/<script src="https:\/\/cdn\.tailwindcss\.com"><\/script>/g, '');
  
  // Replace <style>...</style> with <link rel="stylesheet" href="/css/index.css">
  content = content.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="/css/index.css">');
  
  fs.writeFileSync(path.join(dir, file), content);
}
console.log('Updated ' + files.length + ' HTML files.');
