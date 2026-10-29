#!/usr/bin/env python3
"""Serve a built site at /campus/ to verify deployment below an arbitrary path."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
class Handler(SimpleHTTPRequestHandler):
 def translate_path(self,path):
  if path.startswith('/campus/'):
   path=path[len('/campus'):]
  else:path='/__not_found__'
  return super().translate_path(path)
 def do_GET(self):
  if self.path in ('/','/campus'):
   self.send_response(302);self.send_header('Location','/campus/');self.end_headers();return
  super().do_GET()
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=4174);a=p.parse_args()
 root=Path(__file__).resolve().parents[1]/'dist'
 server=ThreadingHTTPServer(('127.0.0.1',a.port),lambda *args,**kw:Handler(*args,directory=str(root),**kw))
 print(f'Preview: http://127.0.0.1:{a.port}/campus/',flush=True)
 server.serve_forever()
