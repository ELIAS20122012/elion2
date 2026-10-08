@echo off
chcp 65001 >nul
title Elias OS - publish website
cd /d "%~dp0.."
echo  [1/3] Cloudflare login - a browser opens, click Allow.
call npx -y wrangler@latest login
echo  [2/3] Creating site project...
call npx -y wrangler@latest pages project create elion-os-site --production-branch main
echo  [3/3] Uploading site...
call npx -y wrangler@latest pages deploy site --project-name elion-os-site --branch main
pause
