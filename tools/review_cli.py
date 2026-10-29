#!/usr/bin/env python3
"""Per-invocation model override for the installed subscription supervisor.
No global configuration or installed skill is modified.
"""
import argparse, importlib.util, pathlib, sys
p=argparse.ArgumentParser(add_help=False)
p.add_argument('--model',required=True)
a,rest=p.parse_known_args()
source=pathlib.Path.home()/'.codex/skills/claude-codex-collab/scripts/collab.py'
spec=importlib.util.spec_from_file_location('campus_collab',source)
m=importlib.util.module_from_spec(spec)
sys.modules[spec.name]=m
spec.loader.exec_module(m)
original=m.command
def command(args,session):
    cmd=original(args,session)
    if '--model' in cmd:
        i=cmd.index('--model');del cmd[i:i+2]
    cmd.extend(['--model',a.model])
    return cmd
m.command=command
sys.argv=[str(source),*rest]
sys.exit(m.main())
