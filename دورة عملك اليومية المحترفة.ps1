# خطوات مزامنة وحماية المشروع بالكامل
git add .
git commit -m "تحديث جديد: عمل يومي"
git fetch origin
git merge origin/main
git push origin HEAD

npm install
npm update   # تحديث الحزم إن أردت
npm audit
npm audit fix
npm run build
git status

Write-Host "كل شيء تمت مزامنته وبُني بنجاح! 🚀"