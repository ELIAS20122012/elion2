@echo off
cd /d "%~dp0"
(
echo --- where python ---
where python
where py
echo --- py -0 ---
py -0
echo --- python --version ---
python --version
py -3 --version
echo --- ffmpeg ---
where ffmpeg
echo --- disk ---
wmic logicaldisk get caption,freespace
) > data\diag.txt 2>&1
