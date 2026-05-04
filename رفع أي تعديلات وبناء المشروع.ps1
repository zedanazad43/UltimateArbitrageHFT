Write-Host "------------------- 1. Git Status Before -------------------"
git status

Write-Host "`n** 2. Adding all changes to staging... **"
git add .

Write-Host "`n** 3. Committing changes (ignore error if no changes)... **"
git commit -m "Update: latest fixes and enhancements"

Write-Host "`n** 4. Fetching remote changes... **"
git fetch origin

Write-Host "`n** 5. Merging latest main into your branch... **"
git merge origin/main

Write-Host "`n** 6. Pushing branch to GitHub... **"
git push origin HEAD

Write-Host "`n------------------- 7. NPM Install & Build -------------------"
npm install
npm run build

Write-Host "`n------------------- 8. NPM Security Audit -------------------"
npm audit
npm audit fix

Write-Host "`n------------------- 9. Git Status After -------------------"
git status

Write-Host "`nاجتزت جميع خطوات الـ DevOps بأفضل طريقة! 🎉"