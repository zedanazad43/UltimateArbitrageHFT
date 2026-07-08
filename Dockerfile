FROM node:18
WORKDIR /app
COPY orchestrator.js .
COPY models/ /app/models/
CMD ["node", "orchestrator.js"]
