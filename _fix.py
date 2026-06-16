with open("aimaster/cli.py","rb") as f: d=f.read()
d=d.replace(b"Race all providers\\n  aimaster council \\\"Q\\\"           # LLM Council", b"Race all providers")
with open("aimaster/cli.py","wb") as f: f.write(d)
print("Fixed")

