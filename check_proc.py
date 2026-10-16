import ctypes
from ctypes import wintypes

user32 = ctypes.windll.user32

titles = []

def enum_windows_proc(hwnd, lParam):
    if user32.IsWindowVisible(hwnd):
        length = user32.GetWindowTextLengthW(hwnd)
        if length > 0:
            buff = ctypes.create_unicode_buffer(length + 1)
            user32.GetWindowTextW(hwnd, buff, length + 1)
            titles.append((hwnd, buff.value))
    return True

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
cb = EnumWindowsProc(enum_windows_proc)
user32.EnumWindows(cb, 0)

for hwnd, title in titles:
    print(f"[{hwnd}] {title}")
