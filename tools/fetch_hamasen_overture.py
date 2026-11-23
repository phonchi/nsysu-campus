#!/usr/bin/env python3
"""Extract the district's ODbL building candidates from one pinned Overture shard.

Run with DuckDB installed and its signed httpfs extension available. The generator
consumes the resulting local extract, never requiring a runtime map service.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path

from shapely import from_wkb, to_geojson


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'data/sources/hamasen/overture-buildings.json'
RELEASE = '2026-11-18.0'
BOUNDS = [120.26815, 22.6195, 120.27630, 22.62555]
STAC_ITEM = f'https://stac.overturemaps.org/{RELEASE}/buildings/building/00377/00377.json'
PARQUET = f'/release/{RELEASE}/theme=buildings/type=building/part-00377-6b775542-1dbb-5466-ab23-676bc2ac4b90-c000.zstd.parquet'
MIRRORS = ('https://overturemaps-us-west-2.s3.us-west-2.amazonaws.com',
           'https://overturemapswestus2.blob.core.windows.net')
FIELDS = ('id', 'class', 'subtype', 'num_floors', 'height', 'name', 'sources', 'level',
          'min_height', 'is_underground', 'facade_color', 'roof_color', 'roof_shape')


def acquire(connection):
    from duckdb import Error

    query = '''SELECT id, class, subtype, num_floors, height, names.primary, sources, level,
        min_height, is_underground, facade_color, roof_color, roof_shape, geometry
        FROM read_parquet(?)
        WHERE bbox.xmin <= ? AND bbox.xmax >= ? AND bbox.ymin <= ? AND bbox.ymax >= ?
        ORDER BY id'''
    west, south, east, north = BOUNDS
    errors = []
    for host in MIRRORS:
        url = host + PARQUET
        try:
            return url, connection.execute(query, [url, east, west, north, south]).fetchall()
        except Error as error:
            errors.append(str(error))
    raise RuntimeError('\n'.join(errors))


def main():
    import duckdb

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=OUT)
    parser.add_argument('--httpfs-extension', type=Path, help='Path to a signed matching httpfs extension')
    args = parser.parse_args()
    with duckdb.connect() as connection:
        extension = str(args.httpfs_extension.resolve()) if args.httpfs_extension else 'httpfs'
        connection.load_extension(extension)
        connection.execute('SET enable_geoparquet_conversion=false; SET threads=4')
        url, rows = acquire(connection)
    if not rows:
        raise RuntimeError('Overture returned no Hamasen features')
    features = [{'type':'Feature', 'properties':dict(zip(FIELDS, row[:-1])),
                 'geometry':json.loads(to_geojson(from_wkb(row[-1])))} for row in rows]
    source = {'release':RELEASE, 'url':url, 'item':STAC_ITEM, 'dataset':'theme=buildings/type=building',
              'bbox':BOUNDS, 'retrievedAt':datetime.now(timezone.utc).isoformat(), 'license':'ODbL 1.0',
              'licenseUrl':'https://docs.overturemaps.org/attribution/'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({'source':source, 'features':features}, ensure_ascii=False,
                                      separators=(',', ':'))+'\n', encoding='utf-8')
    print(f'{len(features)} Overture footprints → {args.output}')


if __name__ == '__main__':
    main()
