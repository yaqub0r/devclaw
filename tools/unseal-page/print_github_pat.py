#!/usr/bin/env python3
import re
import subprocess

note = subprocess.check_output(['lpass', 'show', '--notes', '1138842277103865951'], text=True)
m = re.search(r'GH_TOKEN=(\S+)', note)
if not m:
    raise SystemExit('GH_TOKEN not found in note')
print(m.group(1))
