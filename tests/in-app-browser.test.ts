import { describe, expect, it } from 'vitest';
import { inAppBrowserName } from '../src/walk/in-app-browser';

describe('in-app browser detection', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari Line/14.0.0', 'LINE'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 Line/14.1.0/IAB', 'LINE'],
    ['Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0', 'Instagram'],
  ])('%s', (ua, name) => expect(inAppBrowserName(ua)).toBe(name));
  it.each([
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0) Online/1.0 Chrome/130',
  ])('leaves %s alone', ua => expect(inAppBrowserName(ua)).toBeUndefined());
});
