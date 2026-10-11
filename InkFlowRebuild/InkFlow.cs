using System;
using System.CodeDom.Compiler;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using System.Text.Json;
using System.Threading;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Forms;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Markup;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using System.Windows.Threading;
using Microsoft.Win32;
namespace InkFlow;

public partial class AboutWindow : Window, IComponentConnector
{

	public AboutWindow()
	{
		InitializeComponent();
	}

	private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		DragMove();
	}

	private void Close_Click(object sender, RoutedEventArgs e)
	{
		Close();
	}
}
public partial class App : System.Windows.Application
{
	private NotifyIcon? _trayIcon;

	private MainWindow? _overlay;

	private Toolbar? _toolbar;

	private static readonly string LogPath = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "InkFlow", "crash.log");

	private static System.Threading.Mutex? _instanceMutex;

	private SettingsWindow? _settingsWindow;

	private AboutWindow? _aboutWindow;


	protected override void OnStartup(StartupEventArgs e)
	{
		bool createdNew;
		_instanceMutex = new System.Threading.Mutex(true, "InkFlow_SingleInstance_Mutex", out createdNew);
		if (!createdNew && IsAnotherInstanceRunning())
		{
			ActivateExistingInstance();
			System.Windows.Application.Current.Shutdown();
			return;
		}
		base.OnStartup(e);
		base.DispatcherUnhandledException += App_DispatcherUnhandledException;
		AppDomain.CurrentDomain.UnhandledException += CurrentDomain_UnhandledException;
		_overlay = new MainWindow();
		_toolbar = new Toolbar(_overlay);
		_overlay.Show();
		_toolbar.Show();
		_overlay.AttachToolbar(_toolbar);
		_toolbar.SettingsRequested += OpenSettings;
		_overlay.ScreenshotSaved += delegate(string path)
		{
			_trayIcon?.ShowBalloonTip(2000, "اسکرین\u200cشات ذخیره شد", path, ToolTipIcon.Info);
		};
		try
		{
			SetupTrayIcon();
		}
		catch (Exception ex2)
		{
			LogError("SetupTrayIcon", ex2);
		}
	}

	private static bool IsAnotherInstanceRunning()
	{
		try
		{
			System.Diagnostics.Process current = System.Diagnostics.Process.GetCurrentProcess();
			foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName(current.ProcessName))
			{
				if (p.Id != current.Id)
				{
					return true;
				}
			}
		}
		catch
		{
		}
		return false;
	}

	private static void ActivateExistingInstance()
	{
		try
		{
			System.Diagnostics.Process current = System.Diagnostics.Process.GetCurrentProcess();
			foreach (System.Diagnostics.Process p in System.Diagnostics.Process.GetProcessesByName(current.ProcessName))
			{
				if (p.Id == current.Id)
				{
					continue;
				}
				NativeMethods.EnumWindows(delegate(IntPtr hwnd, IntPtr lParam)
				{
					NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
					if (pid == p.Id && NativeMethods.IsWindowVisible(hwnd))
					{
						NativeMethods.ShowWindow(hwnd, 9);
						NativeMethods.SetForegroundWindow(hwnd);
					}
					return true;
				}, IntPtr.Zero);
			}
		}
		catch
		{
		}
	}

	private static void LogError(string context, Exception ex)
	{
		try
		{
			Directory.CreateDirectory(System.IO.Path.GetDirectoryName(LogPath));
			File.AppendAllText(LogPath, $"[{DateTime.Now:yyyy-MM-dd HH:mm:ss}] {context}:\n{ex}\n\n");
		}
		catch
		{
		}
	}

	private void App_DispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
	{
		LogError("DispatcherUnhandledException", e.Exception);
		System.Windows.MessageBox.Show("یک خطای غیرمنتظره رخ داد:\n\n" + e.Exception.Message + "\n\nجزئیات کامل در این فایل ذخیره شد:\n" + LogPath, "InkFlow - خطا", MessageBoxButton.OK, MessageBoxImage.Hand);
		e.Handled = true;
	}

	private void CurrentDomain_UnhandledException(object sender, UnhandledExceptionEventArgs e)
	{
		if (e.ExceptionObject is Exception ex)
		{
			LogError("AppDomain.UnhandledException", ex);
			System.Windows.MessageBox.Show("یک خطای بحرانی رخ داد:\n\n" + ex.Message + "\n\nجزئیات کامل در این فایل ذخیره شد:\n" + LogPath, "InkFlow - خطای بحرانی", MessageBoxButton.OK, MessageBoxImage.Hand);
		}
	}

	private void SetupTrayIcon()
	{
		_trayIcon = new NotifyIcon
		{
			Icon = CreateTrayIcon(),
			Visible = true,
			Text = "elion - right-click for options"
		};
		ContextMenuStrip contextMenuStrip = new ContextMenuStrip();
		contextMenuStrip.Items.Add("Show / Hide Toolbar", null, delegate
		{
			_toolbar?.ToggleFullyVisible();
		});
		contextMenuStrip.Items.Add("Pause / Resume Drawing  (F9)", null, delegate
		{
			_overlay?.ToggleClickThrough();
		});
		contextMenuStrip.Items.Add("Clear All  (Ctrl+Shift+X)", null, delegate
		{
			_overlay?.ClearAll();
		});
		contextMenuStrip.Items.Add(new ToolStripSeparator());
		contextMenuStrip.Items.Add("Settings...", null, delegate
		{
			OpenSettings();
		});
		contextMenuStrip.Items.Add("About...", null, delegate
		{
			OpenAbout();
		});
		contextMenuStrip.Items.Add(new ToolStripSeparator());
		contextMenuStrip.Items.Add("Exit elion", null, delegate
		{
			ExitApp();
		});
		_trayIcon.ContextMenuStrip = contextMenuStrip;
		_trayIcon.DoubleClick += delegate
		{
			_toolbar?.ToggleFullyVisible();
		};
	}

	public static void ShowSettingsWindow()
	{
		(System.Windows.Application.Current as App)?.OpenSettings();
	}

	public static void ShowAboutWindow()
	{
		(System.Windows.Application.Current as App)?.OpenAbout();
	}

	private void OpenSettings()
	{
		if (_overlay == null || _toolbar == null)
		{
			return;
		}
		if (_settingsWindow != null)
		{
			_settingsWindow.Activate();
			return;
		}
		_overlay.SuppressOverlayTopmost();
		_settingsWindow = new SettingsWindow(_overlay, _toolbar);
		_settingsWindow.Closed += delegate
		{
			_settingsWindow = null;
			_overlay.RestoreOverlayTopmostIfNeeded();
		};
		_settingsWindow.Show();
		_settingsWindow.Activate();
	}

	private void OpenAbout()
	{
		if (_overlay == null)
		{
			return;
		}
		if (_aboutWindow != null)
		{
			_aboutWindow.Activate();
			return;
		}
		_overlay.SuppressOverlayTopmost();
		_aboutWindow = new AboutWindow();
		_aboutWindow.Closed += delegate
		{
			_aboutWindow = null;
			_overlay.RestoreOverlayTopmostIfNeeded();
		};
		_aboutWindow.Show();
		_aboutWindow.Activate();
	}

	private void ExitApp()
	{
		if (_trayIcon != null)
		{
			_trayIcon.Visible = false;
			_trayIcon.Dispose();
		}
		Shutdown();
	}

	private static Icon CreateTrayIcon()
	{
		try
		{
			Icon icon = Icon.ExtractAssociatedIcon(Assembly.GetExecutingAssembly().Location);
			if (icon != null)
			{
				return icon;
			}
		}
		catch
		{
		}
		using Bitmap bitmap = new Bitmap(32, 32);
		using (Graphics graphics = Graphics.FromImage(bitmap))
		{
			graphics.Clear(System.Drawing.Color.Transparent);
			graphics.SmoothingMode = SmoothingMode.AntiAlias;
			using SolidBrush brush = new SolidBrush(System.Drawing.Color.FromArgb(230, 90, 90, 100));
			graphics.FillEllipse(brush, 3, 3, 26, 26);
			using System.Drawing.Pen pen = new System.Drawing.Pen(System.Drawing.Color.White, 2.5f);
			graphics.DrawLine(pen, 10, 20, 22, 10);
		}
		return Icon.FromHandle(bitmap.GetHicon());
	}
}
public class AppSettings
{
	public string ThemeMode { get; set; } = "dark";

	public int ToolbarOpacityPercent { get; set; } = 100;

	public string ToolbarOrientation { get; set; } = "vertical";

	public int ToolbarStyleVersion { get; set; }

	public string ScreenshotFolder { get; set; } = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);

	public string ScreenshotFormat { get; set; } = "png";

	public int JpegQuality { get; set; } = 90;

	public bool ScreenshotAutoSave { get; set; }

	public HotkeySettings Hotkeys { get; set; } = new HotkeySettings();
}
public class HotkeyBinding
{
	public uint Modifiers { get; set; }

	public uint Vk { get; set; }

	public string Label { get; set; } = "";
}
public class HotkeySettings
{
	public HotkeyBinding PauseResume { get; set; } = new HotkeyBinding
	{
		Modifiers = 0u,
		Vk = 120u,
		Label = "F9"
	};

	public HotkeyBinding BoardCycle { get; set; } = new HotkeyBinding
	{
		Modifiers = 0u,
		Vk = 121u,
		Label = "F10"
	};

	public HotkeyBinding Screenshot { get; set; } = new HotkeyBinding
	{
		Modifiers = 0u,
		Vk = 122u,
		Label = "F11"
	};

	public HotkeyBinding Undo { get; set; } = new HotkeyBinding
	{
		Modifiers = 2u,
		Vk = 90u,
		Label = "Ctrl+Z"
	};

	public HotkeyBinding ClearAll { get; set; } = new HotkeyBinding
	{
		Modifiers = 6u,
		Vk = 88u,
		Label = "Ctrl+Shift+X"
	};

	public HotkeyBinding RecallPen { get; set; } = new HotkeyBinding
	{
		Modifiers = 2u,
		Vk = 32u,
		Label = "Ctrl+Space"
	};
}
public enum Tool
{
	Pen,
	Highlighter,
	Arrow,
	Eraser,
	Text
}
public partial class MainWindow : Window, IComponentConnector
{
	public enum BoardMode
	{
		None,
		White,
		Black
	}

	private bool _isDrawing;

	private System.Windows.Point _startPoint;

	private Polyline? _currentPolyline;

	private Canvas? _currentArrow;

	private Line? _currentArrowShaft;

	private Polygon? _currentArrowHead;

	private bool _clickThrough;

	private nint _hwnd;

	private DispatcherTimer? _topmostTimer;

	private Toolbar? _toolbar;

	private const int HOTKEY_TOGGLE_CLICKTHROUGH = 9001;

	private const int HOTKEY_UNDO = 9002;

	private const int HOTKEY_CLEAR = 9003;

	private const int HOTKEY_WHITEBOARD = 9004;

	private const int HOTKEY_SCREENSHOT = 9005;

	private const int HOTKEY_EXIT = 9006;

	private const int HOTKEY_ESCAPE = 9007;

	private const int HOTKEY_RECALL = 9008;

	private bool _escapeRegistered;

	private int _dialogSuppressCount;

	private DispatcherTimer? _recallTapTimer;

	private const int DoubleTapWindowMs = 350;

	private static readonly System.Windows.Media.Brush NearInvisibleBrush = new SolidColorBrush(System.Windows.Media.Color.FromArgb(1, 0, 0, 0));

	private static ScreenshotResultWindow? _activeResultWindow;

	private bool _isPickingColor;

	private Bitmap? _eyedropperBitmap;

	private double _eyedropperDpiX = 1.0;

	private double _eyedropperDpiY = 1.0;

	private bool _isSelectingRegion;

	private System.Windows.Shapes.Rectangle? _selectionRect;

	private System.Windows.Point _selectionStart;



	public Tool CurrentTool { get; set; }

	public System.Windows.Media.Color CurrentColor { get; set; } = Colors.Red;

	public double CurrentThickness { get; set; } = 4.0;

	public BoardMode CurrentBoardMode { get; private set; }

	public bool IsClickThrough => _clickThrough;

	public event Action<bool>? ClickThroughChanged;

	public event Action<string>? ScreenshotSaved;

	public event Action<System.Windows.Media.Color>? ColorPicked;

	public void AttachToolbar(Toolbar toolbar)
	{
		_toolbar = toolbar;
	}

	public MainWindow()
	{
		InitializeComponent();
		base.Left = SystemParameters.VirtualScreenLeft;
		base.Top = SystemParameters.VirtualScreenTop;
		base.Width = SystemParameters.VirtualScreenWidth;
		base.Height = SystemParameters.VirtualScreenHeight;
	}

	protected override void OnSourceInitialized(EventArgs e)
	{
		base.OnSourceInitialized(e);
		_hwnd = new WindowInteropHelper(this).Handle;
		int windowLong = NativeMethods.GetWindowLong(_hwnd, -20);
		windowLong |= 0x8080080;
		NativeMethods.SetWindowLong(_hwnd, -20, windowLong);
		HwndSource.FromHwnd(_hwnd)?.AddHook(WndProc);
		RegisterHotKeys();
		UpdateEscapeHotkeyRegistration();
		_topmostTimer = new DispatcherTimer
		{
			Interval = TimeSpan.FromMilliseconds(2000.0)
		};
		_topmostTimer.Tick += delegate
		{
			if (_dialogSuppressCount <= 0)
			{
				NativeMethods.SetWindowPos(_hwnd, NativeMethods.HWND_TOPMOST, 0, 0, 0, 0, 19u);
				_toolbar?.ReassertTopmost();
			}
		};
		_topmostTimer.Start();
	}

	private void RegisterHotKeys()
	{
		HotkeySettings hotkeys = SettingsManager.Current.Hotkeys;
		NativeMethods.RegisterHotKey(_hwnd, 9001, hotkeys.PauseResume.Modifiers | 0x4000, hotkeys.PauseResume.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9002, hotkeys.Undo.Modifiers | 0x4000, hotkeys.Undo.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9003, hotkeys.ClearAll.Modifiers | 0x4000, hotkeys.ClearAll.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9004, hotkeys.BoardCycle.Modifiers | 0x4000, hotkeys.BoardCycle.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9005, hotkeys.Screenshot.Modifiers | 0x4000, hotkeys.Screenshot.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9008, hotkeys.RecallPen.Modifiers | 0x4000, hotkeys.RecallPen.Vk);
		NativeMethods.RegisterHotKey(_hwnd, 9006, 16387u, 81u);
	}

	private void UnregisterConfigurableHotKeys()
	{
		NativeMethods.UnregisterHotKey(_hwnd, 9001);
		NativeMethods.UnregisterHotKey(_hwnd, 9002);
		NativeMethods.UnregisterHotKey(_hwnd, 9003);
		NativeMethods.UnregisterHotKey(_hwnd, 9004);
		NativeMethods.UnregisterHotKey(_hwnd, 9005);
		NativeMethods.UnregisterHotKey(_hwnd, 9008);
	}

	public void ReapplyHotkeys()
	{
		UnregisterConfigurableHotKeys();
		RegisterHotKeys();
	}

	private nint WndProc(nint hwnd, int msg, nint wParam, nint lParam, ref bool handled)
	{
		if (msg == 786)
		{
			switch (((IntPtr)wParam).ToInt32())
			{
			case 9001:
				ToggleClickThrough();
				break;
			case 9002:
				Undo();
				break;
			case 9003:
				ClearAll();
				break;
			case 9004:
				CycleBoardMode();
				break;
			case 9005:
				TakeScreenshot();
				break;
			case 9006:
				System.Windows.Application.Current.Shutdown();
				break;
			case 9007:
				DeactivateTool();
				break;
			case 9008:
				HandleRecallHotkey();
				break;
			}
			handled = true;
		}
		return IntPtr.Zero;
	}

	public void SuppressOverlayTopmost()
	{
		_dialogSuppressCount++;
		base.Topmost = false;
	}

	public void RestoreOverlayTopmostIfNeeded()
	{
		_dialogSuppressCount = Math.Max(0, _dialogSuppressCount - 1);
		if (_dialogSuppressCount == 0)
		{
			base.Topmost = true;
		}
	}

	public void ToggleClickThrough()
	{
		_clickThrough = !_clickThrough;
		int windowLong = NativeMethods.GetWindowLong(_hwnd, -20);
		windowLong = (_clickThrough ? (windowLong | 0x20) : (windowLong & -33));
		NativeMethods.SetWindowLong(_hwnd, -20, windowLong);
		UpdateEscapeHotkeyRegistration();
		this.ClickThroughChanged?.Invoke(_clickThrough);
	}

	private void UpdateEscapeHotkeyRegistration()
	{
		if (!_clickThrough && !_escapeRegistered)
		{
			NativeMethods.RegisterHotKey(_hwnd, 9007, 16384u, 27u);
			_escapeRegistered = true;
		}
		else if (_clickThrough && _escapeRegistered)
		{
			NativeMethods.UnregisterHotKey(_hwnd, 9007);
			_escapeRegistered = false;
		}
	}

	public void DeactivateTool()
	{
		if (!_clickThrough)
		{
			ToggleClickThrough();
		}
	}

	private void HandleRecallHotkey()
	{
		if (_recallTapTimer != null)
		{
			_recallTapTimer.Stop();
			_recallTapTimer = null;
			WakeAppFromStopped();
			return;
		}
		_recallTapTimer = new DispatcherTimer
		{
			Interval = TimeSpan.FromMilliseconds(350.0)
		};
		_recallTapTimer.Tick += delegate
		{
			_recallTapTimer?.Stop();
			_recallTapTimer = null;
			RecallPenAndActivate();
		};
		_recallTapTimer.Start();
	}

	private void RecallPenAndActivate()
	{
		CurrentTool = Tool.Pen;
		if (_clickThrough)
		{
			ToggleClickThrough();
		}
		_toolbar?.HighlightPenTool();
	}

	private void WakeAppFromStopped()
	{
		_toolbar?.WakeFromCollapsed();
		RecallPenAndActivate();
	}

	public void SetBoardMode(BoardMode mode)
	{
		CurrentBoardMode = mode;
		Canvas drawCanvas = DrawCanvas;
		drawCanvas.Background = mode switch
		{
			BoardMode.White => System.Windows.Media.Brushes.White, 
			BoardMode.Black => System.Windows.Media.Brushes.Black, 
			_ => NearInvisibleBrush, 
		};
	}

	public void CycleBoardMode()
	{
		SetBoardMode(CurrentBoardMode switch
		{
			BoardMode.None => BoardMode.White, 
			BoardMode.White => BoardMode.Black, 
			_ => BoardMode.None, 
		});
	}

	public void ClearAll()
	{
		DrawCanvas.Children.Clear();
	}

	public void Undo()
	{
		if (DrawCanvas.Children.Count != 0)
		{
			DrawCanvas.Children.RemoveAt(DrawCanvas.Children.Count - 1);
		}
	}

	public void TakeScreenshot()
	{
		Rect workArea = SystemParameters.WorkArea;
		CaptureScreenRegionDip(workArea.Left, workArea.Top, workArea.Width, workArea.Height);
	}

	public void StartEyedropper()
	{
		PresentationSource presentationSource = PresentationSource.FromVisual(this);
		_eyedropperDpiX = 1.0;
		_eyedropperDpiY = 1.0;
		if (presentationSource?.CompositionTarget != null)
		{
			_eyedropperDpiX = presentationSource.CompositionTarget.TransformToDevice.M11;
			_eyedropperDpiY = presentationSource.CompositionTarget.TransformToDevice.M22;
		}
		int val = (int)Math.Round(SystemParameters.VirtualScreenWidth * _eyedropperDpiX);
		int val2 = (int)Math.Round(SystemParameters.VirtualScreenHeight * _eyedropperDpiY);
		_eyedropperBitmap?.Dispose();
		_eyedropperBitmap = new Bitmap(Math.Max(1, val), Math.Max(1, val2), System.Drawing.Imaging.PixelFormat.Format32bppArgb);
		using (Graphics graphics = Graphics.FromImage(_eyedropperBitmap))
		{
			graphics.CopyFromScreen((int)Math.Round(SystemParameters.VirtualScreenLeft * _eyedropperDpiX), (int)Math.Round(SystemParameters.VirtualScreenTop * _eyedropperDpiY), 0, 0, _eyedropperBitmap.Size);
		}
		_isPickingColor = true;
		base.Cursor = System.Windows.Input.Cursors.Cross;
	}

	private void FinishEyedropper(System.Windows.Point localDip)
	{
		_isPickingColor = false;
		base.Cursor = System.Windows.Input.Cursors.Arrow;
		if (_eyedropperBitmap != null)
		{
			int num = (int)Math.Round(localDip.X * _eyedropperDpiX);
			int num2 = (int)Math.Round(localDip.Y * _eyedropperDpiY);
			if (num >= 0 && num2 >= 0 && num < _eyedropperBitmap.Width && num2 < _eyedropperBitmap.Height)
			{
				System.Drawing.Color pixel = _eyedropperBitmap.GetPixel(num, num2);
				System.Windows.Media.Color obj = (CurrentColor = System.Windows.Media.Color.FromRgb(pixel.R, pixel.G, pixel.B));
				this.ColorPicked?.Invoke(obj);
			}
			_eyedropperBitmap.Dispose();
			_eyedropperBitmap = null;
		}
	}

	public void StartRegionScreenshot()
	{
		_isSelectingRegion = true;
		base.Cursor = System.Windows.Input.Cursors.Cross;
	}

	private void BeginRegionSelection(System.Windows.Point p)
	{
		_selectionStart = p;
		_selectionRect = new System.Windows.Shapes.Rectangle
		{
			Stroke = System.Windows.Media.Brushes.DodgerBlue,
			StrokeThickness = 1.5,
			StrokeDashArray = new DoubleCollection { 4.0, 3.0 },
			Fill = new SolidColorBrush(System.Windows.Media.Color.FromArgb(40, 79, 140, byte.MaxValue))
		};
		Canvas.SetLeft(_selectionRect, p.X);
		Canvas.SetTop(_selectionRect, p.Y);
		DrawCanvas.Children.Add(_selectionRect);
	}

	private void UpdateRegionSelection(System.Windows.Point p)
	{
		if (_selectionRect != null)
		{
			double length = Math.Min(p.X, _selectionStart.X);
			double length2 = Math.Min(p.Y, _selectionStart.Y);
			_selectionRect.Width = Math.Abs(p.X - _selectionStart.X);
			_selectionRect.Height = Math.Abs(p.Y - _selectionStart.Y);
			Canvas.SetLeft(_selectionRect, length);
			Canvas.SetTop(_selectionRect, length2);
		}
	}

	private void FinishRegionSelection()
	{
		_isSelectingRegion = false;
		base.Cursor = System.Windows.Input.Cursors.Arrow;
		if (_selectionRect != null)
		{
			double left = Canvas.GetLeft(_selectionRect);
			double top = Canvas.GetTop(_selectionRect);
			double width = _selectionRect.Width;
			double height = _selectionRect.Height;
			DrawCanvas.Children.Remove(_selectionRect);
			_selectionRect = null;
			base.Dispatcher.Invoke(delegate
			{
			}, DispatcherPriority.Render);
			if (!(width < 6.0) && !(height < 6.0))
			{
				double leftDip = SystemParameters.VirtualScreenLeft + left;
				double topDip = SystemParameters.VirtualScreenTop + top;
				CaptureScreenRegionDip(leftDip, topDip, width, height);
			}
		}
	}

	private void CaptureScreenRegionDip(double leftDip, double topDip, double widthDip, double heightDip)
	{
		double num = 1.0;
		double num2 = 1.0;
		PresentationSource presentationSource = PresentationSource.FromVisual(this);
		if (presentationSource?.CompositionTarget != null)
		{
			num = presentationSource.CompositionTarget.TransformToDevice.M11;
			num2 = presentationSource.CompositionTarget.TransformToDevice.M22;
		}
		_toolbar?.Hide();
		Thread.Sleep(50);
		int sourceX = (int)Math.Round(leftDip * num);
		int sourceY = (int)Math.Round(topDip * num2);
		int val = (int)Math.Round(widthDip * num);
		int val2 = (int)Math.Round(heightDip * num2);
		Bitmap bitmap = new Bitmap(Math.Max(1, val), Math.Max(1, val2), System.Drawing.Imaging.PixelFormat.Format32bppArgb);
		using (Graphics graphics = Graphics.FromImage(bitmap))
		{
			graphics.CopyFromScreen(sourceX, sourceY, 0, 0, bitmap.Size);
		}
		_toolbar?.Show();
		_toolbar?.ReassertTopmost();
		AppSettings current = SettingsManager.Current;
		bool flag = current.ScreenshotFormat == "jpeg";
		string value = (flag ? ".jpg" : ".png");
		if (current.ScreenshotAutoSave)
		{
			try
			{
				Directory.CreateDirectory(current.ScreenshotFolder);
				string text = System.IO.Path.Combine(current.ScreenshotFolder, $"screenshot_{DateTime.Now:yyyyMMdd_HHmmss}{value}");
				SaveBitmap(bitmap, text, flag, current.JpegQuality);
				this.ScreenshotSaved?.Invoke(text);
				return;
			}
			catch (Exception ex)
			{
				System.Windows.MessageBox.Show("Could not save screenshot:\n" + ex.Message, "Error", MessageBoxButton.OK, MessageBoxImage.Hand);
				return;
			}
			finally
			{
				bitmap.Dispose();
			}
		}
		SuppressOverlayTopmost();
		string suggestedFileName = $"screenshot_{DateTime.Now:yyyyMMdd_HHmmss}";
		if (_activeResultWindow != null)
		{
			_activeResultWindow.Close();
			_activeResultWindow = null;
		}
		ScreenshotResultWindow screenshotResultWindow = new ScreenshotResultWindow(bitmap, flag, current.JpegQuality, current.ScreenshotFolder, suggestedFileName);
		_activeResultWindow = screenshotResultWindow;
		screenshotResultWindow.SavedPath += delegate(string path)
		{
			this.ScreenshotSaved?.Invoke(path);
		};
		screenshotResultWindow.Closed += delegate
		{
			if (_activeResultWindow == screenshotResultWindow)
			{
				_activeResultWindow = null;
			}
			RestoreOverlayTopmostIfNeeded();
		};
		screenshotResultWindow.Show();
		screenshotResultWindow.Activate();
	}

	private static void SaveBitmap(Bitmap bmp, string path, bool asJpeg, int quality)
	{
		if (asJpeg)
		{
			ImageCodecInfo encoder = ImageCodecInfo.GetImageEncoders().First((ImageCodecInfo c) => c.FormatID == ImageFormat.Jpeg.Guid);
			EncoderParameters encoderParameters = new EncoderParameters(1);
			encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, Math.Clamp(quality, 1, 100));
			bmp.Save(path, encoder, encoderParameters);
		}
		else
		{
			bmp.Save(path, ImageFormat.Png);
		}
	}

	private System.Windows.Media.Brush ToolBrush(double opacity = 1.0)
	{
		System.Windows.Media.Color currentColor = CurrentColor;
		return new SolidColorBrush(System.Windows.Media.Color.FromArgb((byte)(opacity * 255.0), currentColor.R, currentColor.G, currentColor.B));
	}

	private void DrawCanvas_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		if (_clickThrough)
		{
			return;
		}
		_startPoint = e.GetPosition(DrawCanvas);
		_isDrawing = true;
		if (_isPickingColor)
		{
			FinishEyedropper(_startPoint);
			return;
		}
		if (_isSelectingRegion)
		{
			BeginRegionSelection(_startPoint);
			return;
		}
		switch (CurrentTool)
		{
		case Tool.Pen:
		case Tool.Highlighter:
			_currentPolyline = new Polyline
			{
				Stroke = ToolBrush((CurrentTool == Tool.Highlighter) ? 0.35 : 1.0),
				StrokeThickness = ((CurrentTool == Tool.Highlighter) ? (CurrentThickness * 3.0) : CurrentThickness),
				StrokeLineJoin = PenLineJoin.Round,
				StrokeStartLineCap = PenLineCap.Round,
				StrokeEndLineCap = PenLineCap.Round
			};
			_currentPolyline.Points.Add(_startPoint);
			DrawCanvas.Children.Add(_currentPolyline);
			break;
		case Tool.Arrow:
			BeginArrow(_startPoint);
			break;
		case Tool.Eraser:
			EraseAt(_startPoint);
			break;
		case Tool.Text:
			_isDrawing = false;
			AddTextBox(_startPoint);
			break;
		}
	}

	private void DrawCanvas_MouseMove(object sender, System.Windows.Input.MouseEventArgs e)
	{
		if (!_isDrawing || _clickThrough)
		{
			return;
		}
		System.Windows.Point position = e.GetPosition(DrawCanvas);
		if (_isSelectingRegion)
		{
			UpdateRegionSelection(position);
			return;
		}
		switch (CurrentTool)
		{
		case Tool.Pen:
		case Tool.Highlighter:
			_currentPolyline?.Points.Add(position);
			break;
		case Tool.Arrow:
			UpdateArrow(position);
			break;
		case Tool.Eraser:
			EraseAt(position);
			break;
		}
	}

	private void DrawCanvas_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
	{
		if (_isSelectingRegion)
		{
			_isDrawing = false;
			FinishRegionSelection();
			return;
		}
		if (CurrentTool == Tool.Pen && _currentPolyline != null && _currentPolyline.Points.Count >= 6)
		{
			TryRecognizeShape(_currentPolyline);
		}
		_isDrawing = false;
		_currentPolyline = null;
		_currentArrow = null;
		_currentArrowShaft = null;
		_currentArrowHead = null;
	}

	private void BeginArrow(System.Windows.Point start)
	{
		System.Windows.Media.Brush brush = ToolBrush();
		_currentArrow = new Canvas
		{
			Width = DrawCanvas.ActualWidth,
			Height = DrawCanvas.ActualHeight,
			IsHitTestVisible = false
		};
		_currentArrowShaft = new Line
		{
			X1 = start.X,
			Y1 = start.Y,
			X2 = start.X,
			Y2 = start.Y,
			Stroke = brush,
			StrokeThickness = CurrentThickness,
			StrokeStartLineCap = PenLineCap.Round,
			StrokeEndLineCap = PenLineCap.Round
		};
		_currentArrowHead = new Polygon
		{
			Fill = brush,
			Stroke = brush,
			StrokeThickness = Math.Max(1.0, CurrentThickness * 0.35),
			StrokeLineJoin = PenLineJoin.Round
		};
		_currentArrow.Children.Add(_currentArrowShaft);
		_currentArrow.Children.Add(_currentArrowHead);
		DrawCanvas.Children.Add(_currentArrow);
		UpdateArrow(start);
	}

	private void UpdateArrow(System.Windows.Point end)
	{
		if (_currentArrowShaft != null && _currentArrowHead != null)
		{
			_currentArrowShaft.X2 = end.X;
			_currentArrowShaft.Y2 = end.Y;
			double num = end.X - _startPoint.X;
			double num2 = end.Y - _startPoint.Y;
			double num3 = Math.Sqrt(num * num + num2 * num2);
			_currentArrowHead.Points.Clear();
			if (!(num3 < 1.0))
			{
				double num4 = num / num3;
				double num5 = num2 / num3;
				double num6 = Math.Clamp(CurrentThickness * 3.2 + 8.0, 12.0, 30.0);
				double num7 = num6 * 0.48;
				double num8 = end.X - num4 * num6;
				double num9 = end.Y - num5 * num6;
				double num10 = 0.0 - num5;
				double num11 = num4;
				_currentArrowHead.Points.Add(end);
				_currentArrowHead.Points.Add(new System.Windows.Point(num8 + num10 * num7, num9 + num11 * num7));
				_currentArrowHead.Points.Add(new System.Windows.Point(num8 - num10 * num7, num9 - num11 * num7));
			}
		}
	}

	private void EraseAt(System.Windows.Point p)
	{
		Rect rect = new Rect(p.X - 12.0, p.Y - 12.0, 24.0, 24.0);
		for (int num = DrawCanvas.Children.Count - 1; num >= 0; num--)
		{
			UIElement uIElement = DrawCanvas.Children[num];
			Rect descendantBounds = VisualTreeHelper.GetDescendantBounds(uIElement);
			if (uIElement.TransformToAncestor(DrawCanvas).TransformBounds(descendantBounds).IntersectsWith(rect))
			{
				DrawCanvas.Children.RemoveAt(num);
			}
		}
	}

	private void TryRecognizeShape(Polyline stroke)
	{
		List<System.Windows.Point> list = stroke.Points.ToList();
		if (list.Count < 6)
		{
			return;
		}
		double num = 0.0;
		for (int i = 1; i < list.Count; i++)
		{
			num += Distance(list[i - 1], list[i]);
		}
		if (num < 24.0)
		{
			return;
		}
		System.Windows.Point point = list[0];
		System.Windows.Point point2 = list[list.Count - 1];
		double num2 = Distance(point, point2);
		double x = list.Min((System.Windows.Point pt) => pt.X);
		double x2 = list.Max((System.Windows.Point pt) => pt.X);
		double y = list.Min((System.Windows.Point pt) => pt.Y);
		double y2 = list.Max((System.Windows.Point pt) => pt.Y);
		double num3 = Distance(new System.Windows.Point(x, y), new System.Windows.Point(x2, y2));
		if (num3 < 10.0)
		{
			return;
		}
		bool flag = num2 < num3 * 0.18;
		if (!flag && num2 / num > 0.9)
		{
			ReplaceStrokeWithLine(stroke, point, point2);
		}
		else
		{
			if (!flag)
			{
				return;
			}
			List<System.Windows.Point> list2 = SimplifyRDP(list, num3 * 0.055);
			if (list2.Count > 1)
			{
				if (Distance(list2[0], list2[list2.Count - 1]) < num3 * 0.12)
				{
					list2.RemoveAt(list2.Count - 1);
				}
			}
			if (list2.Count == 3)
			{
				ReplaceStrokeWithPolygon(stroke, list2);
				return;
			}
			if (list2.Count == 4)
			{
				List<System.Windows.Point> corners = new List<System.Windows.Point>
				{
					new System.Windows.Point(x, y),
					new System.Windows.Point(x2, y),
					new System.Windows.Point(x2, y2),
					new System.Windows.Point(x, y2)
				};
				ReplaceStrokeWithPolygon(stroke, corners);
				return;
			}
			double x3 = list.Average((System.Windows.Point pt) => pt.X);
			double y3 = list.Average((System.Windows.Point pt) => pt.Y);
			System.Windows.Point centroid = new System.Windows.Point(x3, y3);
			List<double> source = list.Select((System.Windows.Point pt) => Distance(pt, centroid)).ToList();
			double avgR = source.Average();
			double d = source.Select((double num4) => (num4 - avgR) * (num4 - avgR)).Average();
			if (((avgR > 0.0) ? (Math.Sqrt(d) / avgR) : 1.0) < 0.9)
			{
				ReplaceStrokeWithCircle(stroke, centroid, avgR);
			}
		}
	}

	private static double Distance(System.Windows.Point a, System.Windows.Point b)
	{
		double num = a.X - b.X;
		double num2 = a.Y - b.Y;
		return Math.Sqrt(num * num + num2 * num2);
	}

	private static List<System.Windows.Point> SimplifyRDP(List<System.Windows.Point> points, double epsilon)
	{
		if (points.Count < 3)
		{
			return new List<System.Windows.Point>(points);
		}
		double num = 0.0;
		int num2 = 0;
		int num3 = points.Count - 1;
		for (int i = 1; i < num3; i++)
		{
			double num4 = PerpendicularDistance(points[i], points[0], points[num3]);
			if (num4 > num)
			{
				num2 = i;
				num = num4;
			}
		}
		if (num > epsilon)
		{
			List<System.Windows.Point> collection = SimplifyRDP(points.GetRange(0, num2 + 1), epsilon);
			List<System.Windows.Point> collection2 = SimplifyRDP(points.GetRange(num2, num3 - num2 + 1), epsilon);
			List<System.Windows.Point> list = new List<System.Windows.Point>(collection);
			list.RemoveAt(list.Count - 1);
			list.AddRange(collection2);
			return list;
		}
		return new List<System.Windows.Point>
		{
			points[0],
			points[num3]
		};
	}

	private static double PerpendicularDistance(System.Windows.Point p, System.Windows.Point lineStart, System.Windows.Point lineEnd)
	{
		double num = lineEnd.X - lineStart.X;
		double num2 = lineEnd.Y - lineStart.Y;
		double num3 = Math.Sqrt(num * num + num2 * num2);
		if (num3 < 1E-06)
		{
			return Distance(p, lineStart);
		}
		double num4 = ((p.X - lineStart.X) * num + (p.Y - lineStart.Y) * num2) / (num3 * num3);
		return Distance(b: new System.Windows.Point(lineStart.X + num4 * num, lineStart.Y + num4 * num2), a: p);
	}

	private void ReplaceStrokeWithLine(Polyline stroke, System.Windows.Point start, System.Windows.Point end)
	{
		Line element = new Line
		{
			X1 = start.X,
			Y1 = start.Y,
			X2 = end.X,
			Y2 = end.Y,
			Stroke = stroke.Stroke,
			StrokeThickness = stroke.StrokeThickness,
			StrokeStartLineCap = PenLineCap.Round,
			StrokeEndLineCap = PenLineCap.Round
		};
		DrawCanvas.Children.Remove(stroke);
		DrawCanvas.Children.Add(element);
	}

	private void ReplaceStrokeWithCircle(Polyline stroke, System.Windows.Point centroid, double radius)
	{
		Ellipse element = new Ellipse
		{
			Width = radius * 2.0,
			Height = radius * 2.0,
			Stroke = stroke.Stroke,
			StrokeThickness = stroke.StrokeThickness,
			Fill = System.Windows.Media.Brushes.Transparent
		};
		Canvas.SetLeft(element, centroid.X - radius);
		Canvas.SetTop(element, centroid.Y - radius);
		DrawCanvas.Children.Remove(stroke);
		DrawCanvas.Children.Add(element);
	}

	private void ReplaceStrokeWithPolygon(Polyline stroke, List<System.Windows.Point> corners)
	{
		Polygon polygon = new Polygon
		{
			Stroke = stroke.Stroke,
			StrokeThickness = stroke.StrokeThickness,
			Fill = System.Windows.Media.Brushes.Transparent,
			StrokeLineJoin = PenLineJoin.Round
		};
		foreach (System.Windows.Point corner in corners)
		{
			polygon.Points.Add(corner);
		}
		DrawCanvas.Children.Remove(stroke);
		DrawCanvas.Children.Add(polygon);
	}

	private void AddTextBox(System.Windows.Point p)
	{
		System.Windows.Controls.TextBox tb = new System.Windows.Controls.TextBox
		{
			Foreground = ToolBrush(),
			Background = System.Windows.Media.Brushes.Transparent,
			BorderThickness = new Thickness(0.0),
			FontFamily = new System.Windows.Media.FontFamily("Segoe UI"),
			FontWeight = FontWeights.Medium,
			FlowDirection = System.Windows.FlowDirection.RightToLeft,
			TextAlignment = TextAlignment.Right,
			Language = XmlLanguage.GetLanguage("fa-IR"),
			FontSize = Math.Max(16.0, CurrentThickness * 6.0),
			MinWidth = 120.0,
			Cursor = System.Windows.Input.Cursors.IBeam
		};
		Canvas.SetLeft(tb, p.X);
		Canvas.SetTop(tb, p.Y);
		DrawCanvas.Children.Add(tb);
		Ellipse handle = new Ellipse
		{
			Width = 14.0,
			Height = 14.0,
			Fill = ToolBrush(),
			Stroke = System.Windows.Media.Brushes.White,
			StrokeThickness = 1.5,
			Cursor = System.Windows.Input.Cursors.SizeAll
		};
		Canvas.SetLeft(handle, p.X - 18.0);
		Canvas.SetTop(handle, p.Y - 2.0);
		DrawCanvas.Children.Add(handle);
		bool dragging = false;
		System.Windows.Point dragStart = default(System.Windows.Point);
		System.Windows.Point boxStart = default(System.Windows.Point);
		handle.MouseLeftButtonDown += delegate(object _, MouseButtonEventArgs de)
		{
			dragging = true;
			handle.CaptureMouse();
			dragStart = de.GetPosition(DrawCanvas);
			boxStart = new System.Windows.Point(Canvas.GetLeft(tb), Canvas.GetTop(tb));
			de.Handled = true;
		};
		handle.MouseMove += delegate(object _, System.Windows.Input.MouseEventArgs me)
		{
			if (dragging)
			{
				System.Windows.Point position = me.GetPosition(DrawCanvas);
				double num = position.X - dragStart.X;
				double num2 = position.Y - dragStart.Y;
				Canvas.SetLeft(tb, boxStart.X + num);
				Canvas.SetTop(tb, boxStart.Y + num2);
				Canvas.SetLeft(handle, boxStart.X + num - 18.0);
				Canvas.SetTop(handle, boxStart.Y + num2 - 2.0);
			}
		};
		handle.MouseLeftButtonUp += delegate
		{
			dragging = false;
			handle.ReleaseMouseCapture();
		};
		tb.Focus();
		tb.LostFocus += delegate
		{
			FinalizeText(tb, handle);
		};
		tb.KeyDown += delegate(object _, System.Windows.Input.KeyEventArgs ke)
		{
			if (ke.Key == Key.Return && !Keyboard.IsKeyDown(Key.LeftShift))
			{
				FinalizeText(tb, handle);
				ke.Handled = true;
			}
		};
	}

	private void FinalizeText(System.Windows.Controls.TextBox tb, Ellipse handle)
	{
		if (DrawCanvas.Children.Contains(handle))
		{
			DrawCanvas.Children.Remove(handle);
		}
		if (DrawCanvas.Children.Contains(tb))
		{
			double left = Canvas.GetLeft(tb);
			double top = Canvas.GetTop(tb);
			DrawCanvas.Children.Remove(tb);
			if (!string.IsNullOrWhiteSpace(tb.Text))
			{
				TextBlock element = new TextBlock
				{
					Text = tb.Text,
					Foreground = tb.Foreground,
					FontFamily = tb.FontFamily,
					FontSize = tb.FontSize,
					FontWeight = tb.FontWeight,
					FlowDirection = tb.FlowDirection,
					TextAlignment = tb.TextAlignment,
					Language = tb.Language,
					MinWidth = ((tb.ActualWidth > 0.0) ? tb.ActualWidth : tb.MinWidth),
					MaxWidth = tb.MaxWidth,
					TextWrapping = TextWrapping.Wrap
				};
				Canvas.SetLeft(element, left);
				Canvas.SetTop(element, top);
				DrawCanvas.Children.Add(element);
			}
		}
	}

	protected override void OnClosed(EventArgs e)
	{
		_topmostTimer?.Stop();
		_recallTapTimer?.Stop();
		NativeMethods.UnregisterHotKey(_hwnd, 9001);
		NativeMethods.UnregisterHotKey(_hwnd, 9002);
		NativeMethods.UnregisterHotKey(_hwnd, 9003);
		NativeMethods.UnregisterHotKey(_hwnd, 9004);
		NativeMethods.UnregisterHotKey(_hwnd, 9005);
		NativeMethods.UnregisterHotKey(_hwnd, 9008);
		NativeMethods.UnregisterHotKey(_hwnd, 9006);
		if (_escapeRegistered)
		{
			NativeMethods.UnregisterHotKey(_hwnd, 9007);
		}
		base.OnClosed(e);
	}
}
internal static class NativeMethods
{
	public struct AccentPolicy
	{
		public int AccentState;

		public int AccentFlags;

		public int GradientColor;

		public int AnimationId;
	}

	public struct WindowCompositionAttributeData
	{
		public int Attribute;

		public nint Data;

		public int SizeOfData;
	}

	public const int GWL_EXSTYLE = -20;

	public const int WS_EX_TRANSPARENT = 32;

	public const int WS_EX_LAYERED = 524288;

	public const int WS_EX_TOOLWINDOW = 128;

	public const int WS_EX_NOACTIVATE = 134217728;

	public static readonly nint HWND_TOPMOST = new IntPtr(-1);

	public const uint SWP_NOMOVE = 2u;

	public const uint SWP_NOSIZE = 1u;

	public const uint SWP_NOACTIVATE = 16u;

	public const uint MOD_ALT = 1u;

	public const uint MOD_CONTROL = 2u;

	public const uint MOD_SHIFT = 4u;

	public const uint MOD_NOREPEAT = 16384u;

	public const int WCA_ACCENT_POLICY = 19;

	public const int ACCENT_ENABLE_ACRYLICBLURBEHIND = 4;

	[DllImport("user32.dll", SetLastError = true)]
	public static extern int GetWindowLong(nint hwnd, int index);

	[DllImport("user32.dll", SetLastError = true)]
	public static extern int SetWindowLong(nint hwnd, int index, int newStyle);

	[DllImport("user32.dll")]
	public static extern bool RegisterHotKey(nint hWnd, int id, uint fsModifiers, uint vk);

	[DllImport("user32.dll")]
	public static extern bool UnregisterHotKey(nint hWnd, int id);

	[DllImport("user32.dll")]
	public static extern bool SetWindowPos(nint hWnd, nint hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

	[DllImport("gdi32.dll")]
	public static extern bool DeleteObject(nint hObject);

	[DllImport("user32.dll")]
	public static extern int SetWindowCompositionAttribute(nint hwnd, ref WindowCompositionAttributeData data);

	[DllImport("user32.dll")]
	public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

	[DllImport("user32.dll")]
	public static extern bool SetForegroundWindow(IntPtr hWnd);

	public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

	[DllImport("user32.dll")]
	public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

	[DllImport("user32.dll")]
	public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

	[DllImport("user32.dll")]
	public static extern bool IsWindowVisible(IntPtr hWnd);
}
public partial class ScreenshotResultWindow : Window, IComponentConnector
{
	private readonly Bitmap _bmp;

	private readonly bool _isJpeg;

	private readonly int _quality;

	private readonly string _suggestedFolder;

	private readonly string _suggestedFileName;

	private bool _disposed;



	public event Action<string>? SavedPath;

	public ScreenshotResultWindow(Bitmap bmp, bool isJpeg, int quality, string suggestedFolder, string suggestedFileName)
	{
		InitializeComponent();
		_bmp = bmp;
		_isJpeg = isJpeg;
		_quality = quality;
		_suggestedFolder = suggestedFolder;
		_suggestedFileName = suggestedFileName;
		PreviewImage.Source = ToBitmapSource(_bmp);
		base.Closed += delegate
		{
			if (!_disposed)
			{
				_bmp.Dispose();
			}
		};
	}

	private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		DragMove();
	}

	private static BitmapSource ToBitmapSource(Bitmap bmp)
	{
		nint hbitmap = bmp.GetHbitmap();
		try
		{
			BitmapSource bitmapSource = Imaging.CreateBitmapSourceFromHBitmap(hbitmap, IntPtr.Zero, Int32Rect.Empty, BitmapSizeOptions.FromEmptyOptions());
			bitmapSource.Freeze();
			return bitmapSource;
		}
		finally
		{
			NativeMethods.DeleteObject(hbitmap);
		}
	}

	private void CopyToClipboard()
	{
		System.Windows.Clipboard.SetImage(ToBitmapSource(_bmp));
	}

	private string? SaveWithDialog()
	{
		string text = (_isJpeg ? ".jpg" : ".png");
		Microsoft.Win32.SaveFileDialog saveFileDialog = new Microsoft.Win32.SaveFileDialog
		{
			Filter = "PNG Image|*.png|JPEG Image|*.jpg",
			FilterIndex = ((!_isJpeg) ? 1 : 2),
			InitialDirectory = (Directory.Exists(_suggestedFolder) ? _suggestedFolder : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures)),
			FileName = _suggestedFileName + text
		};
		if (saveFileDialog.ShowDialog() != true)
		{
			return null;
		}
		bool asJpeg = saveFileDialog.FileName.EndsWith(".jpg", StringComparison.OrdinalIgnoreCase) || saveFileDialog.FileName.EndsWith(".jpeg", StringComparison.OrdinalIgnoreCase);
		SaveBitmap(_bmp, saveFileDialog.FileName, asJpeg, _quality);
		return saveFileDialog.FileName;
	}

	private static void SaveBitmap(Bitmap bmp, string path, bool asJpeg, int quality)
	{
		if (asJpeg)
		{
			ImageCodecInfo encoder = ImageCodecInfo.GetImageEncoders().First((ImageCodecInfo c) => c.FormatID == ImageFormat.Jpeg.Guid);
			EncoderParameters encoderParameters = new EncoderParameters(1);
			encoderParameters.Param[0] = new EncoderParameter(Encoder.Quality, Math.Clamp(quality, 1, 100));
			bmp.Save(path, encoder, encoderParameters);
		}
		else
		{
			bmp.Save(path, ImageFormat.Png);
		}
	}

	private void Copy_Click(object sender, RoutedEventArgs e)
	{
		CopyToClipboard();
		Close();
	}

	private void Save_Click(object sender, RoutedEventArgs e)
	{
		string text = SaveWithDialog();
		if (text != null)
		{
			this.SavedPath?.Invoke(text);
		}
		Close();
	}

	private void Both_Click(object sender, RoutedEventArgs e)
	{
		CopyToClipboard();
		string text = SaveWithDialog();
		if (text != null)
		{
			this.SavedPath?.Invoke(text);
		}
		Close();
	}

	private void Discard_Click(object sender, RoutedEventArgs e)
	{
		Close();
	}
}
public static class SettingsManager
{
	private static readonly string FolderPath = System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "InkFlow");

	private static readonly string FilePath = System.IO.Path.Combine(FolderPath, "settings.json");

	public static AppSettings Current { get; private set; } = Load();

	private static AppSettings Load()
	{
		try
		{
			if (File.Exists(FilePath))
			{
				AppSettings appSettings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(FilePath));
				if (appSettings != null)
				{
					return appSettings;
				}
			}
		}
		catch
		{
		}
		return new AppSettings();
	}

	public static void Save()
	{
		try
		{
			Directory.CreateDirectory(FolderPath);
			string contents = JsonSerializer.Serialize(Current, new JsonSerializerOptions
			{
				WriteIndented = true
			});
			File.WriteAllText(FilePath, contents);
		}
		catch
		{
		}
	}
}
public partial class SettingsWindow : Window, IComponentConnector
{
	private readonly MainWindow _overlay;

	private readonly Toolbar _toolbar;

	private System.Windows.Controls.Button? _recordingButton;

	private Action<HotkeyBinding>? _recordingApply;



















	public SettingsWindow(MainWindow overlay, Toolbar toolbar)
	{
		InitializeComponent();
		_overlay = overlay;
		_toolbar = toolbar;
		AppSettings current = SettingsManager.Current;
		ScreenshotFolderBox.Text = current.ScreenshotFolder;
		RbJpeg.IsChecked = current.ScreenshotFormat == "jpeg";
		RbPng.IsChecked = current.ScreenshotFormat != "jpeg";
		QualitySlider.Value = current.JpegQuality;
		QualityLabel.Text = current.JpegQuality.ToString();
		AutoSaveCheck.IsChecked = current.ScreenshotAutoSave;
		QualityPanel.IsEnabled = current.ScreenshotFormat == "jpeg";
		QualitySlider.ValueChanged += QualitySlider_ValueChanged;
		foreach (string k in AccentKeys)
		{
			_accentOriginals[k] = base.Resources[k];
		}
		string mode = current.ThemeMode ?? "dark";
		RbOrbit.IsChecked = mode == "orbit";
		RbLight.IsChecked = mode == "light";
		RbDark.IsChecked = mode != "light" && mode != "orbit";
		RbVertical.IsChecked = current.ToolbarOrientation == "vertical";
		RbHorizontal.IsChecked = current.ToolbarOrientation != "vertical";
		OpacitySlider.Value = current.ToolbarOpacityPercent;
		OpacitySlider.ValueChanged += OpacitySlider_ValueChanged;
		ApplyWindowTheme(mode);
	}

	private static readonly string[] AccentKeys = new string[7] { "AccentBrush", "AccentFg", "AccentRing", "GoldKnob", "GoldIcon", "GoldFill", "GoldBevel" };

	private readonly Dictionary<string, object> _accentOriginals = new Dictionary<string, object>();

	private string CurrentMode()
	{
		if (RbOrbit.IsChecked == true)
		{
			return "orbit";
		}
		return (RbLight.IsChecked == true) ? "light" : "dark";
	}

	private static System.Windows.Media.Color SHex(string hex)
	{
		return (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
	}

	private static System.Windows.Media.LinearGradientBrush SGrad(System.Windows.Point end, params (string hex, double off)[] stops)
	{
		System.Windows.Media.LinearGradientBrush b = new System.Windows.Media.LinearGradientBrush
		{
			StartPoint = new System.Windows.Point(0.0, 0.0),
			EndPoint = end
		};
		foreach (var st in stops)
		{
			b.GradientStops.Add(new System.Windows.Media.GradientStop(SHex(st.hex), st.off));
		}
		return b;
	}

	private void ApplyWindowTheme(string mode)
	{
		bool light = mode == "light";
		bool orbit = mode == "orbit";
		System.Windows.ResourceDictionary r = base.Resources;
		System.Windows.Point down = new System.Windows.Point(0.0, 1.0);
		System.Windows.Point right = new System.Windows.Point(1.0, 0.0);
		if (light)
		{
			r["WinBg"] = SGrad(down, ("#FDFBF7", 0.0), ("#EFE9DF", 1.0));
			r["WinBevel"] = SGrad(down, ("#FFFFFFFF", 0.0), ("#00FFFFFF", 0.05), ("#00000000", 1.0));
			r["WinBorder"] = new SolidColorBrush(SHex("#E2D9C8"));
			r["WinRing"] = new SolidColorBrush(SHex("#C9993C"));
			r["Fg"] = new SolidColorBrush(SHex("#22252B"));
			r["MutedText"] = new SolidColorBrush(SHex("#4A4E57"));
			r["HintText"] = new SolidColorBrush(SHex("#5D616A"));
			r["DarkBtnBg"] = SGrad(down, ("#FDFBF7", 0.0), ("#EFE8DC", 1.0));
			r["BtnFg"] = new SolidColorBrush(SHex("#22252B"));
			r["BtnBevel"] = SGrad(down, ("#FFFFFFFF", 0.0), ("#00FFFFFF", 0.15), ("#00967846", 0.8), ("#26967846", 1.0));
			r["BtnBorder"] = new SolidColorBrush(SHex("#E2D9C8"));
			r["BtnRing"] = new SolidColorBrush(SHex("#C9993C"));
			r["FieldBg"] = new SolidColorBrush(SHex("#66FFFFFF"));
			r["FieldFg"] = new SolidColorBrush(SHex("#22252B"));
			r["CtlBg"] = new SolidColorBrush(SHex("#66FFFFFF"));
			r["CtlBorder"] = new SolidColorBrush(SHex("#D6CBB6"));
			r["TrackBg"] = new SolidColorBrush(SHex("#E3DCCF"));
			r["AccentText"] = new SolidColorBrush(SHex("#B8913F"));
			r["SectionDivider"] = SGrad(right, ("#C9993C", 0.0), ("#1FC9993C", 1.0));
		}
		else
		{
			r["WinBg"] = SGrad(down, ("#25272C", 0.0), ("#1D1E22", 1.0));
			r["WinBevel"] = SGrad(down, ("#0FFFFFFF", 0.0), ("#00FFFFFF", 0.1), ("#00C9A24E", 0.9), ("#4DC9A24E", 1.0));
			r["WinBorder"] = new SolidColorBrush(Colors.Transparent);
			r["WinRing"] = new SolidColorBrush(Colors.Transparent);
			r["Fg"] = new SolidColorBrush(Colors.White);
			r["MutedText"] = new SolidColorBrush(SHex("#BDB9B0"));
			r["HintText"] = new SolidColorBrush(SHex("#9E9A91"));
			r["DarkBtnBg"] = SGrad(down, ("#3B3E45", 0.0), ("#25272C", 1.0));
			r["BtnFg"] = new SolidColorBrush(SHex("#E6C77E"));
			r["BtnBevel"] = SGrad(down, ("#1AFFFFFF", 0.0), ("#00FFFFFF", 0.2), ("#00C9A24E", 0.8), ("#66C9A24E", 1.0));
			r["BtnBorder"] = new SolidColorBrush(Colors.Transparent);
			r["BtnRing"] = new SolidColorBrush(Colors.Transparent);
			r["FieldBg"] = new SolidColorBrush(SHex("#141518"));
			r["FieldFg"] = new SolidColorBrush(SHex("#D8D4CA"));
			r["CtlBg"] = new SolidColorBrush(SHex("#141518"));
			r["CtlBorder"] = new SolidColorBrush(SHex("#4A4D55"));
			r["TrackBg"] = new SolidColorBrush(SHex("#121316"));
			r["AccentText"] = new SolidColorBrush(SHex("#E6C77E"));
			r["SectionDivider"] = SGrad(right, ("#66D4AF5F", 0.0), ("#14D4AF5F", 1.0));
		}
		foreach (string k in AccentKeys)
		{
			if (_accentOriginals.TryGetValue(k, out object v))
			{
				r[k] = v;
			}
		}
		if (orbit)
		{
			System.Windows.Media.LinearGradientBrush silver = SGrad(down, ("#F4F6FA", 0.0), ("#C3CAD4", 0.5), ("#7D8694", 1.0));
			r["WinBg"] = SGrad(down, ("#16285A", 0.0), ("#070E26", 1.0));
			r["WinBevel"] = SGrad(down, ("#26FFFFFF", 0.0), ("#00FFFFFF", 0.08), ("#00C9D0DA", 0.92), ("#55C9D0DA", 1.0));
			r["WinBorder"] = new SolidColorBrush(SHex("#5C6B94"));
			r["WinRing"] = new SolidColorBrush(SHex("#40C9D0DA"));
			r["Fg"] = new SolidColorBrush(SHex("#EEF1F6"));
			r["MutedText"] = new SolidColorBrush(SHex("#A9B3C6"));
			r["HintText"] = new SolidColorBrush(SHex("#7F8AA3"));
			r["DarkBtnBg"] = SGrad(down, ("#22366E", 0.0), ("#0E1A3C", 1.0));
			r["BtnFg"] = new SolidColorBrush(SHex("#E3E8F0"));
			r["BtnBevel"] = SGrad(down, ("#33FFFFFF", 0.0), ("#00FFFFFF", 0.2), ("#00C9D0DA", 0.8), ("#55C9D0DA", 1.0));
			r["BtnBorder"] = new SolidColorBrush(SHex("#4A5A88"));
			r["FieldBg"] = new SolidColorBrush(SHex("#0A1430"));
			r["FieldFg"] = new SolidColorBrush(SHex("#E3E8F0"));
			r["CtlBg"] = new SolidColorBrush(SHex("#0A1430"));
			r["CtlBorder"] = new SolidColorBrush(SHex("#5C6B94"));
			r["TrackBg"] = new SolidColorBrush(SHex("#0A1430"));
			r["AccentText"] = new SolidColorBrush(SHex("#DDE3EE"));
			r["SectionDivider"] = SGrad(right, ("#99C9D0DA", 0.0), ("#10C9D0DA", 1.0));
			r["AccentBrush"] = silver;
			r["AccentFg"] = new SolidColorBrush(SHex("#0A1430"));
			r["AccentRing"] = new SolidColorBrush(Colors.Transparent);
			r["GoldKnob"] = new System.Windows.Media.RadialGradientBrush(SHex("#FFFFFF"), SHex("#8C95A3")) { GradientOrigin = new System.Windows.Point(0.35, 0.3), Center = new System.Windows.Point(0.35, 0.3), RadiusX = 0.7, RadiusY = 0.7 };
			r["GoldIcon"] = silver;
			r["GoldFill"] = SGrad(right, ("#7D8694", 0.0), ("#F4F6FA", 1.0));
		}
	}

	private void Theme_Changed(object sender, RoutedEventArgs e)
	{
		string mode = ((sender == RbOrbit) ? "orbit" : ((sender == RbLight) ? "light" : "dark"));
		SettingsManager.Current.ThemeMode = mode;
		SettingsManager.Save();
		_toolbar.ApplyTheme(mode, SettingsManager.Current.ToolbarOpacityPercent);
		ApplyWindowTheme(mode);
	}

	private void OpacitySlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
	{
		int num = (int)Math.Round(e.NewValue);
		SettingsManager.Current.ToolbarOpacityPercent = num;
		SettingsManager.Save();
		_toolbar.ApplyTheme(CurrentMode(), num);
	}

	private void Orientation_Changed(object sender, RoutedEventArgs e)
	{
		bool valueOrDefault = RbVertical.IsChecked == true;
		SettingsManager.Current.ToolbarOrientation = (valueOrDefault ? "vertical" : "horizontal");
		SettingsManager.Save();
		_toolbar.ApplyOrientation(valueOrDefault);
	}

	private void PickFolder_Click(object sender, RoutedEventArgs e)
	{
		using FolderBrowserDialog folderBrowserDialog = new FolderBrowserDialog
		{
			Description = "Choose a folder to save screenshots in",
			SelectedPath = SettingsManager.Current.ScreenshotFolder
		};
		if (folderBrowserDialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
		{
			SettingsManager.Current.ScreenshotFolder = folderBrowserDialog.SelectedPath;
			ScreenshotFolderBox.Text = folderBrowserDialog.SelectedPath;
			SettingsManager.Save();
		}
	}

	private void Format_Changed(object sender, RoutedEventArgs e)
	{
		bool valueOrDefault = RbJpeg.IsChecked == true;
		SettingsManager.Current.ScreenshotFormat = (valueOrDefault ? "jpeg" : "png");
		if (QualityPanel != null)
		{
			QualityPanel.IsEnabled = valueOrDefault;
		}
		SettingsManager.Save();
	}

	private void QualitySlider_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
	{
		int jpegQuality = (int)Math.Round(e.NewValue);
		QualityLabel.Text = jpegQuality.ToString();
		SettingsManager.Current.JpegQuality = jpegQuality;
		SettingsManager.Save();
	}

	private void AutoSave_Changed(object sender, RoutedEventArgs e)
	{
		SettingsManager.Current.ScreenshotAutoSave = AutoSaveCheck.IsChecked == true;
		SettingsManager.Save();
	}

	private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		DragMove();
	}

	private void Close_Click(object sender, RoutedEventArgs e)
	{
		Close();
	}

	private void About_Click(object sender, RoutedEventArgs e)
	{
		App.ShowAboutWindow();
	}

	private void ShowGeneralTab_Click(object sender, RoutedEventArgs e)
	{
		GeneralTab.Visibility = Visibility.Visible;
		HotkeysTab.Visibility = Visibility.Collapsed;
		SetTabActive(TabGeneralBtn, TabHotkeysBtn);
	}

	private void SetTabActive(System.Windows.Controls.Button active, System.Windows.Controls.Button inactive)
	{
		active.Style = (System.Windows.Style)FindResource("GoldButton");
		inactive.ClearValue(System.Windows.FrameworkElement.StyleProperty);
	}

	private void ShowHotkeysTab_Click(object sender, RoutedEventArgs e)
	{
		HotkeysTab.Visibility = Visibility.Visible;
		GeneralTab.Visibility = Visibility.Collapsed;
		SetTabActive(TabHotkeysBtn, TabGeneralBtn);
		PopulateHotkeyRows();
	}

	private void PopulateHotkeyRows()
	{
		CancelRecordingIfAny();
		HotkeyRows.RowDefinitions.Clear();
		HotkeyRows.Children.Clear();
		HotkeySettings h = SettingsManager.Current.Hotkeys;
		(string, HotkeyBinding, Action<HotkeyBinding>)[] array = new(string, HotkeyBinding, Action<HotkeyBinding>)[6]
		{
			("Pause / Resume drawing", h.PauseResume, delegate(HotkeyBinding b)
			{
				h.PauseResume = b;
			}),
			("Cycle whiteboard / blackboard", h.BoardCycle, delegate(HotkeyBinding b)
			{
				h.BoardCycle = b;
			}),
			("Screenshot", h.Screenshot, delegate(HotkeyBinding b)
			{
				h.Screenshot = b;
			}),
			("Undo", h.Undo, delegate(HotkeyBinding b)
			{
				h.Undo = b;
			}),
			("Clear all", h.ClearAll, delegate(HotkeyBinding b)
			{
				h.ClearAll = b;
			}),
			("Recall pen / Wake toolbar", h.RecallPen, delegate(HotkeyBinding b)
			{
				h.RecallPen = b;
			})
		};
		for (int num = 0; num < array.Length; num++)
		{
			(string Label, HotkeyBinding Binding, Action<HotkeyBinding> Apply) def = array[num];
			HotkeyRows.RowDefinitions.Add(new RowDefinition
			{
				Height = GridLength.Auto
			});
			TextBlock element = new TextBlock
			{
				Text = def.Label,
				VerticalAlignment = VerticalAlignment.Center,
				Margin = new Thickness(0.0, 6.0, 0.0, 6.0)
			};
			element.SetResourceReference(TextBlock.ForegroundProperty, "Fg");
			Grid.SetRow(element, num);
			Grid.SetColumn(element, 0);
			HotkeyRows.Children.Add(element);
			System.Windows.Controls.Button btn = new System.Windows.Controls.Button
			{
				Content = def.Binding.Label,
				Width = 140.0,
				FontWeight = System.Windows.FontWeights.SemiBold,
				Margin = new Thickness(0.0, 4.0, 0.0, 4.0)
			};
			btn.Click += delegate
			{
				StartRecording(btn, def.Apply);
			};
			Grid.SetRow(btn, num);
			Grid.SetColumn(btn, 1);
			HotkeyRows.Children.Add(btn);
		}
	}

	private void StartRecording(System.Windows.Controls.Button btn, Action<HotkeyBinding> apply)
	{
		CancelRecordingIfAny();
		_recordingButton = btn;
		_recordingApply = apply;
		btn.Content = "Press keys... (Esc to cancel)";
		base.PreviewKeyDown += Recording_PreviewKeyDown;
		Focus();
	}

	private void CancelRecordingIfAny()
	{
		if (_recordingButton != null)
		{
			base.PreviewKeyDown -= Recording_PreviewKeyDown;
			_recordingButton = null;
			_recordingApply = null;
		}
	}

	private void Recording_PreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
	{
		e.Handled = true;
		Key key = ((e.Key == Key.System) ? e.SystemKey : e.Key);
		if (((uint)(key - 70) <= 1u || (uint)(key - 116) <= 5u) ? true : false)
		{
			return;
		}
		Action<HotkeyBinding> recordingApply = _recordingApply;
		base.PreviewKeyDown -= Recording_PreviewKeyDown;
		_recordingButton = null;
		_recordingApply = null;
		if (key == Key.Escape)
		{
			PopulateHotkeyRows();
			return;
		}
		uint num = 0u;
		if (Keyboard.IsKeyDown(Key.LeftCtrl) || Keyboard.IsKeyDown(Key.RightCtrl))
		{
			num |= 2;
		}
		if (Keyboard.IsKeyDown(Key.LeftAlt) || Keyboard.IsKeyDown(Key.RightAlt))
		{
			num |= 1;
		}
		if (Keyboard.IsKeyDown(Key.LeftShift) || Keyboard.IsKeyDown(Key.RightShift))
		{
			num |= 4;
		}
		int vk = KeyInterop.VirtualKeyFromKey(key);
		if (IsReservedCombo(num, (uint)vk))
		{
			System.Windows.MessageBox.Show("This key combination is reserved and can't be used (either a Windows system shortcut, or a plain letter/number that would interfere with normal typing).", "Reserved shortcut", MessageBoxButton.OK, MessageBoxImage.Exclamation);
			PopulateHotkeyRows();
			return;
		}
		string label = FormatCombo(num, key);
		recordingApply?.Invoke(new HotkeyBinding
		{
			Modifiers = num,
			Vk = (uint)vk,
			Label = label
		});
		SettingsManager.Save();
		_overlay.ReapplyHotkeys();
		PopulateHotkeyRows();
	}

	private static bool IsReservedCombo(uint modifiers, uint vk)
	{
		if (modifiers == 1 && vk == 32)
		{
			return true;
		}
		if (modifiers == 1 && (vk == 9 || vk == 115))
		{
			return true;
		}
		if (modifiers == 0 && vk >= 48 && vk <= 90)
		{
			return true;
		}
		return false;
	}

	private static string FormatCombo(uint modifiers, Key key)
	{
		List<string> list = new List<string>();
		if ((modifiers & 2) != 0)
		{
			list.Add("Ctrl");
		}
		if ((modifiers & 1) != 0)
		{
			list.Add("Alt");
		}
		if ((modifiers & 4) != 0)
		{
			list.Add("Shift");
		}
		list.Add(key.ToString());
		return string.Join("+", list);
	}

	private void ResetHotkeys_Click(object sender, RoutedEventArgs e)
	{
		SettingsManager.Current.Hotkeys = new HotkeySettings();
		SettingsManager.Save();
		_overlay.ReapplyHotkeys();
		PopulateHotkeyRows();
	}
}
public partial class Toolbar : Window, IComponentConnector
{
	private readonly MainWindow _overlay;

	private nint _hwnd;

	private bool _minimized;

	private bool _weEnabledClickThrough;

	private double _fullWidth;

	private double _fullHeight;

	private bool _isVertical;

	private string _themeMode = "dark";

	private System.Windows.Controls.Button? _selectedToolButton;

	private const double HorizontalWidth = 362.0;

	private const double HorizontalHeight = 42.0;

	private const double VerticalWidth = 42.0;

	private const double VerticalHeight = 362.0;

	private const double MiniSize = 34.0;

	private const int HoldToExitMs = 800;

	private DispatcherTimer? _holdTimer;

	private DateTime _holdStartTime;

























	public bool IsMinimized => _minimized;

	public event Action? SettingsRequested;

	public Toolbar(MainWindow overlay)
	{
		InitializeComponent();
		_overlay = overlay;
		if (SettingsManager.Current.ToolbarStyleVersion < 2)
		{
			SettingsManager.Current.ThemeMode = "dark";
			SettingsManager.Current.ToolbarStyleVersion = 2;
			SettingsManager.Save();
		}
		_themeMode = SettingsManager.Current.ThemeMode ?? "dark";
		ApplyOrientation(SettingsManager.Current.ToolbarOrientation == "vertical");
		base.Left = SystemParameters.WorkArea.Right - base.Width - 20.0;
		base.Top = 20.0;
		if (base.Top + base.Height > SystemParameters.WorkArea.Bottom)
		{
			base.Top = Math.Max(0.0, SystemParameters.WorkArea.Bottom - base.Height);
		}
		UpdateColorButtonFill(_overlay.CurrentColor);
		_overlay.ColorPicked += OnColorPicked;
		UpdateThicknessPreview();
		HighlightSelectedTool(BtnPenGroup);
		ApplyTheme(SettingsManager.Current.ThemeMode ?? "dark", SettingsManager.Current.ToolbarOpacityPercent);
		_overlay.ClickThroughChanged += OnOverlayClickThroughChanged;
	}

	public void ApplyOrientation(bool isVertical)
	{
		bool flag = base.IsLoaded && !_minimized;
		double num = base.Left + base.Width;
		double top = base.Top;
		_isVertical = isVertical;
		MainPanel.Orientation = (isVertical ? System.Windows.Controls.Orientation.Vertical : System.Windows.Controls.Orientation.Horizontal);
		ToolsPanel.Orientation = (isVertical ? System.Windows.Controls.Orientation.Vertical : System.Windows.Controls.Orientation.Horizontal);
		DragHandle.LayoutTransform = new RotateTransform(isVertical ? 90 : 0);
		DragHandle.Margin = (isVertical ? new Thickness(0.0, 2.0, 0.0, 1.0) : new Thickness(2.0, 0.0, 1.0, 0.0));
		AccentRail.Width = (isVertical ? 2 : 44);
		AccentRail.Height = (isVertical ? 44 : 2);
		AccentRail.HorizontalAlignment = ((!isVertical) ? System.Windows.HorizontalAlignment.Center : System.Windows.HorizontalAlignment.Left);
		AccentRail.VerticalAlignment = (isVertical ? VerticalAlignment.Center : VerticalAlignment.Top);
		AccentRail.Margin = (isVertical ? new Thickness(2.0, 0.0, 0.0, 0.0) : new Thickness(0.0, 2.0, 0.0, 0.0));
		foreach (object child in MainPanel.Children)
		{
			if (child is System.Windows.Shapes.Rectangle rectangle)
			{
				rectangle.Width = ((!isVertical) ? 1 : 14);
				rectangle.Height = (isVertical ? 1.0 : double.NaN);
				double dm = 2.0;
				double dl = 8.0;
				rectangle.Margin = (isVertical ? new Thickness(dl, dm, dl, dm) : new Thickness(dm, dl, dm, dl));
				rectangle.Fill = (System.Windows.Media.Brush)FindResource(isVertical ? "DividerH" : "DividerV");
			}
		}
		double g = ((_themeMode == "orbit") ? 2.0 : 1.5);
		Thickness gap = (isVertical ? new Thickness(0.0, g, 0.0, g) : new Thickness(g, 0.0, g, 0.0));
		foreach (object child2 in MainPanel.Children)
		{
			if (child2 is System.Windows.Controls.Button b1)
			{
				b1.Margin = gap;
			}
		}
		foreach (object child3 in ToolsPanel.Children)
		{
			if (child3 is System.Windows.Controls.Button b2)
			{
				b2.Margin = gap;
			}
		}
		Popup[] array = new Popup[5] { PenGroupPopup, ColorPopup, ThicknessPopup, BoardPopup, ScreenshotPopup };
		foreach (Popup obj in array)
		{
			obj.Placement = (isVertical ? PlacementMode.Left : PlacementMode.Bottom);
			obj.HorizontalOffset = (isVertical ? (-4) : 0);
			obj.VerticalOffset = ((!isVertical) ? 4 : 0);
		}
		double thin = 42.0;
		double longSide = ((_themeMode == "orbit") ? 370.0 : 362.0);
		_fullWidth = (isVertical ? thin : longSide);
		_fullHeight = (isVertical ? longSide : thin);
		if (!_minimized)
		{
			base.Width = _fullWidth;
			base.Height = _fullHeight;
		}
		if (flag)
		{
			Rect workArea = SystemParameters.WorkArea;
			base.Left = Math.Clamp(num - base.Width, workArea.Left, workArea.Right - base.Width);
			base.Top = Math.Clamp(top, workArea.Top, workArea.Bottom - base.Height);
		}
	}

	private static System.Windows.Media.Color Hex(string hex, byte alpha = 255)
	{
		System.Windows.Media.Color c = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(hex);
		return System.Windows.Media.Color.FromArgb(alpha, c.R, c.G, c.B);
	}

	private static System.Windows.Media.LinearGradientBrush VGrad(params (string hex, double off)[] stops)
	{
		System.Windows.Media.LinearGradientBrush b = new System.Windows.Media.LinearGradientBrush
		{
			StartPoint = new System.Windows.Point(0.0, 0.0),
			EndPoint = new System.Windows.Point(0.0, 1.0)
		};
		foreach (var st in stops)
		{
			b.GradientStops.Add(new System.Windows.Media.GradientStop((System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString(st.hex), st.off));
		}
		return b;
	}

	private static System.Windows.Media.LinearGradientBrush Fade(string hex, byte alpha, bool horizontal)
	{
		System.Windows.Media.LinearGradientBrush b = new System.Windows.Media.LinearGradientBrush
		{
			StartPoint = new System.Windows.Point(0.0, 0.0),
			EndPoint = (horizontal ? new System.Windows.Point(1.0, 0.0) : new System.Windows.Point(0.0, 1.0))
		};
		b.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(hex, 0), 0.0));
		b.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(hex, alpha), 0.5));
		b.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(hex, 0), 1.0));
		return b;
	}

	public void ApplyTheme(bool isDark, int opacityPercent)
	{
		ApplyTheme(isDark ? "dark" : "light", opacityPercent);
	}

	private static System.Windows.Media.LinearGradientBrush Diag(string c1, string c2)
	{
		return new System.Windows.Media.LinearGradientBrush(Hex(c1), Hex(c2), new System.Windows.Point(0.0, 0.0), new System.Windows.Point(1.0, 1.0));
	}

	private static System.Windows.Media.LinearGradientBrush IconDiag(string c1, string c2)
	{
		return new System.Windows.Media.LinearGradientBrush(Hex(c1), Hex(c2), new System.Windows.Point(4.0, 2.0), new System.Windows.Point(20.0, 22.0)) { MappingMode = System.Windows.Media.BrushMappingMode.Absolute };
	}

	private static System.Windows.Media.LinearGradientBrush SilverIcon()
	{
		return new System.Windows.Media.LinearGradientBrush(new System.Windows.Media.GradientStopCollection
		{
			new System.Windows.Media.GradientStop(Hex("#FFFFFF"), 0.0),
			new System.Windows.Media.GradientStop(Hex("#D5DBE4"), 0.45),
			new System.Windows.Media.GradientStop(Hex("#8C95A3"), 1.0)
		}, new System.Windows.Point(0.0, 2.0), new System.Windows.Point(0.0, 19.0)) { MappingMode = System.Windows.Media.BrushMappingMode.Absolute };
	}

	private static readonly string[] ResKeysPerButton = new string[4] { "BtnBorder", "BtnShadow", "IconBrush", "ActiveBrush" };

	private static void CollectButtons(object node, List<System.Windows.Controls.Button> list)
	{
		if (node is System.Windows.Controls.Button b)
		{
			list.Add(b);
		}
		if (node is DependencyObject d)
		{
			foreach (object child in LogicalTreeHelper.GetChildren(d))
			{
				CollectButtons(child, list);
			}
		}
	}

	private void ApplyOrbitGroups(bool orbit)
	{
		List<(System.Windows.Controls.Button, char)> items = new List<(System.Windows.Controls.Button, char)>
		{
			(BtnPenGroup, 'O'), (BtnText, 'O'), (BtnEraser, 'O'), (BtnColor, 'G'), (BtnThickness, 'G'),
			(BtnBoard, 'M'), (BtnScreenshot, 'M'), (BtnPauseExit, 'B')
		};
		foreach (object child in MainPanel.Children)
		{
			if (child is System.Windows.Controls.Button mb && mb.ToolTip is string tip)
			{
				if (tip.StartsWith("Undo") || tip.StartsWith("Clear"))
				{
					items.Add((mb, 'M'));
				}
				else if (tip == "Settings")
				{
					items.Add((mb, 'B'));
				}
			}
		}
		(Popup, char)[] pops = new (Popup, char)[5] { (PenGroupPopup, 'O'), (ColorPopup, 'G'), (ThicknessPopup, 'G'), (BoardPopup, 'M'), (ScreenshotPopup, 'M') };
		foreach ((Popup pop, char grp) in pops)
		{
			List<System.Windows.Controls.Button> list = new List<System.Windows.Controls.Button>();
			CollectButtons(pop.Child, list);
			foreach (System.Windows.Controls.Button pb in list)
			{
				bool swatch = pb.Tag is string t && t.StartsWith("#");
				items.Add((pb, swatch ? 'N' : grp));
			}
		}
		foreach ((System.Windows.Controls.Button btn, char grp) in items)
		{
			foreach (string key in ResKeysPerButton)
			{
				btn.Resources.Remove(key);
			}
			if (!orbit)
			{
				continue;
			}
			(string c1, string c2, string glow) = ((grp == 'N') ? ("#3A4C82", "#2A3A6A", "#000000") : ("#F4F6FA", "#7D8694", "#9FB4FF"));
			btn.Resources["BtnBorder"] = Diag(c1, c2);
			if (grp != 'N')
			{
				btn.Resources["IconBrush"] = SilverIcon();
				btn.Resources["ActiveBrush"] = new SolidColorBrush(Hex("#E8EDF5"));
			}
			btn.Resources["BtnShadow"] = ((grp == 'N') ? new System.Windows.Media.Effects.DropShadowEffect { Color = Colors.Black, BlurRadius = 4.0, ShadowDepth = 2.0, Direction = 270.0, Opacity = 0.5 } : new System.Windows.Media.Effects.DropShadowEffect { Color = Hex(glow), BlurRadius = 8.0, ShadowDepth = 0.0, Opacity = 0.35 });
		}
	}

	public void ApplyTheme(string mode, int opacityPercent)
	{
		bool orbit = mode == "orbit";
		bool isDark = mode != "light";
		bool sizeChanged = (_themeMode == "orbit") != orbit;
		_themeMode = (orbit ? "orbit" : (isDark ? "dark" : "light"));
		byte a = (byte)Math.Round((double)Math.Clamp(opacityPercent, 30, 100) / 100.0 * 255.0);
		System.Windows.Media.LinearGradientBrush panelBrush = new System.Windows.Media.LinearGradientBrush
		{
			StartPoint = new System.Windows.Point(0.0, 0.0),
			EndPoint = new System.Windows.Point(0.0, 1.0)
		};
		panelBrush.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(orbit ? "#18295A" : (isDark ? "#2C2E34" : "#FDFBF7"), a), 0.0));
		if (isDark && !orbit)
		{
			panelBrush.GradientStops.Add(new System.Windows.Media.GradientStop(Hex("#222428", a), 0.5));
		}
		panelBrush.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(orbit ? "#070E26" : (isDark ? "#1A1B1F" : "#ECE5D8"), a), 1.0));
		FullBar.CornerRadius = new CornerRadius(22.0);
		FullBar.Background = panelBrush;
		System.Windows.Media.RadialGradientBrush miniBrush = new System.Windows.Media.RadialGradientBrush
		{
			GradientOrigin = new System.Windows.Point(0.4, 0.3),
			Center = new System.Windows.Point(0.4, 0.3),
			RadiusX = 0.7,
			RadiusY = 0.7
		};
		miniBrush.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(isDark ? "#3F424A" : "#FDFBF7", a), 0.0));
		miniBrush.GradientStops.Add(new System.Windows.Media.GradientStop(Hex(isDark ? "#1D1F23" : "#EFE8DC", a), 1.0));
		MiniBar.Background = miniBrush;
		MiniBar.BorderBrush = (isDark ? new SolidColorBrush(Hex("#D4AF5F", 140)) : new SolidColorBrush(Hex("#C9993C")));
		System.Windows.ResourceDictionary r = base.Resources;
		if (isDark)
		{
			r["BtnRaised"] = VGrad(("#3B3E45", 0.0), ("#2B2D33", 0.55), ("#222429", 1.0));
			r["BtnBevel"] = VGrad(("#1AFFFFFF", 0.0), ("#00FFFFFF", 0.2), ("#00C9A24E", 0.8), ("#66C9A24E", 1.0));
			r["BtnBorder"] = new SolidColorBrush(Colors.Transparent);
			r["BtnRing"] = new SolidColorBrush(Colors.Transparent);
			r["BtnShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Color = Colors.Black, BlurRadius = 5.0, ShadowDepth = 2.0, Direction = 270.0, Opacity = 0.6 };
			r["IconShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Color = Colors.Black, BlurRadius = 0.0, ShadowDepth = 0.0, Opacity = 0.0 };
			r["PopupBg"] = VGrad(("#2A2C31", 0.0), ("#1E2024", 1.0));
			r["PopupBorderBrush"] = new SolidColorBrush(Hex("#3A3D44"));
			r["PopupRing"] = new SolidColorBrush(Colors.Transparent);
			r["BarBorder"] = new SolidColorBrush(Colors.Transparent);
			r["BarRing"] = new SolidColorBrush(Colors.Transparent);
			r["DividerV"] = Fade("#D4AF5F", 115, false);
			r["DividerH"] = Fade("#D4AF5F", 115, true);
			r["DotBrush"] = new System.Windows.Media.RadialGradientBrush(Hex("#5A5D66"), Hex("#101114")) { GradientOrigin = new System.Windows.Point(0.35, 0.3), Center = new System.Windows.Point(0.35, 0.3), RadiusX = 0.75, RadiusY = 0.75 };
			r["IconBrush"] = new System.Windows.Media.LinearGradientBrush(new System.Windows.Media.GradientStopCollection
			{
				new System.Windows.Media.GradientStop(Hex("#F6E2A6"), 0.0),
				new System.Windows.Media.GradientStop(Hex("#D4AF5F"), 0.5),
				new System.Windows.Media.GradientStop(Hex("#9A7333"), 1.0)
			}, new System.Windows.Point(0.0, 1.0), new System.Windows.Point(0.0, 19.0)) { MappingMode = System.Windows.Media.BrushMappingMode.Absolute };
		}
		else
		{
			r["BtnRaised"] = VGrad(("#FDFBF7", 0.0), ("#EFE8DC", 1.0));
			r["BtnBevel"] = VGrad(("#FFFFFFFF", 0.0), ("#00FFFFFF", 0.15), ("#00967846", 0.8), ("#26967846", 1.0));
			r["BtnBorder"] = new SolidColorBrush(Hex("#E4DCCD"));
			r["BtnRing"] = new SolidColorBrush(Hex("#C9993C"));
			r["BtnShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Color = Hex("#785F37"), BlurRadius = 8.0, ShadowDepth = 3.0, Direction = 270.0, Opacity = 0.3 };
			r["IconShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Color = Hex("#64410F"), BlurRadius = 1.0, ShadowDepth = 1.0, Direction = 270.0, Opacity = 0.55 };
			r["PopupBg"] = VGrad(("#FDFBF7", 0.0), ("#EFE9DF", 1.0));
			r["PopupBorderBrush"] = new SolidColorBrush(Hex("#E2D9C8"));
			r["PopupRing"] = new SolidColorBrush(Hex("#C9993C"));
			r["BarBorder"] = new SolidColorBrush(Hex("#E2D9C8"));
			r["BarRing"] = new SolidColorBrush(Hex("#C9993C"));
			r["DividerV"] = Fade("#C9993C", 166, false);
			r["DividerH"] = Fade("#C9993C", 166, true);
			r["DotBrush"] = new System.Windows.Media.RadialGradientBrush(Hex("#FFFFFF"), Hex("#8A8E96")) { GradientOrigin = new System.Windows.Point(0.35, 0.3), Center = new System.Windows.Point(0.35, 0.3), RadiusX = 0.75, RadiusY = 0.75 };
			r["IconBrush"] = new System.Windows.Media.LinearGradientBrush(new System.Windows.Media.GradientStopCollection
			{
				new System.Windows.Media.GradientStop(Hex("#FBE39A"), 0.0),
				new System.Windows.Media.GradientStop(Hex("#D9A43A"), 0.45),
				new System.Windows.Media.GradientStop(Hex("#8A5A12"), 1.0)
			}, new System.Windows.Point(0.0, 1.0), new System.Windows.Point(0.0, 19.0)) { MappingMode = System.Windows.Media.BrushMappingMode.Absolute };
		}
		r["BtnSize"] = 25.0;
		r["BtnCorner"] = new CornerRadius(8.0);
		r["BtnCornerOuter"] = new CornerRadius(8.0);
		r["RingCorner"] = new CornerRadius(6.0);
		r["BtnBorderThickness"] = new Thickness(1.0);
		r["ActiveMargin"] = new Thickness(0.0);
		r["HaloVis"] = Visibility.Collapsed;
		r["ClassicVis"] = Visibility.Visible;
		r["LuxVis"] = Visibility.Collapsed;
		r["ActiveBrush"] = new SolidColorBrush(Hex(isDark ? "#D4AF5F" : "#B8862C"));
		MiniBar.BorderThickness = new Thickness(1.0);
		MiniBar.Resources.Remove("IconBrush");
		if (orbit)
		{
			r["BtnSize"] = 25.0;
			r["BtnCorner"] = new CornerRadius(12.5);
			r["BtnCornerOuter"] = new CornerRadius(20.0);
			r["RingCorner"] = new CornerRadius(10.0);
			r["BtnBorderThickness"] = new Thickness(1.6);
			r["ActiveMargin"] = new Thickness(-3.0);
			r["HaloVis"] = Visibility.Visible;
			r["ClassicVis"] = Visibility.Collapsed;
			r["LuxVis"] = Visibility.Visible;
			r["HaloOuter"] = new SolidColorBrush(Hex("#34457A"));
			r["HaloInner"] = new SolidColorBrush(Hex("#0A1330"));
			r["ActiveBrush"] = new SolidColorBrush(Hex("#E8EDF5"));
			r["BtnRaised"] = new System.Windows.Media.RadialGradientBrush(Hex("#22366E"), Hex("#0A1430")) { GradientOrigin = new System.Windows.Point(0.5, 0.3), Center = new System.Windows.Point(0.5, 0.3), RadiusX = 0.75, RadiusY = 0.75 };
			r["BtnBevel"] = new SolidColorBrush(Colors.Transparent);
			r["BtnRing"] = new SolidColorBrush(Colors.Transparent);
			r["BtnBorder"] = Diag("#F4F6FA", "#7D8694");
			r["IconShadow"] = new System.Windows.Media.Effects.DropShadowEffect { Color = Colors.Black, BlurRadius = 0.0, ShadowDepth = 0.0, Opacity = 0.0 };
			r["PopupBg"] = VGrad(("#16285A", 0.0), ("#081230", 1.0));
			r["PopupBorderBrush"] = new SolidColorBrush(Hex("#5C6B94"));
			r["PopupRing"] = new SolidColorBrush(Colors.Transparent);
			r["BarBorder"] = Diag("#C9D0DA", "#4A5A88");
			r["BarRing"] = new SolidColorBrush(Colors.Transparent);
			r["DividerV"] = Fade("#C9D0DA", 140, false);
			r["DividerH"] = Fade("#C9D0DA", 140, true);
			r["DotBrush"] = new System.Windows.Media.RadialGradientBrush(Hex("#FFFFFF"), Hex("#7D8694")) { GradientOrigin = new System.Windows.Point(0.35, 0.3), Center = new System.Windows.Point(0.35, 0.3), RadiusX = 0.75, RadiusY = 0.75 };
			r["IconBrush"] = SilverIcon();
			MiniBar.Background = new System.Windows.Media.RadialGradientBrush(Hex("#22366E", a), Hex("#0A1430", a)) { GradientOrigin = new System.Windows.Point(0.5, 0.3), Center = new System.Windows.Point(0.5, 0.3) };
			MiniBar.BorderBrush = Diag("#F4F6FA", "#7D8694");
			MiniBar.BorderThickness = new Thickness(1.6);
		}
		ApplyOrbitGroups(orbit);
		if (_selectedToolButton != null)
		{
			_selectedToolButton.BorderThickness = new Thickness(orbit ? 1.5 : 1.0);
		}
		if (sizeChanged)
		{
			ApplyOrientation(_isVertical);
		}
		foreach (object child in MainPanel.Children)
		{
			if (child is System.Windows.Shapes.Rectangle rectangle)
			{
				rectangle.Fill = (System.Windows.Media.Brush)r[_isVertical ? "DividerH" : "DividerV"];
			}
		}
	}

	private void OnOverlayClickThroughChanged(bool isClickThrough)
	{
		UpdatePauseIcon();
		if (isClickThrough)
		{
			ClearToolSelection();
		}
	}

	protected override void OnSourceInitialized(EventArgs e)
	{
		base.OnSourceInitialized(e);
		_hwnd = new WindowInteropHelper(this).Handle;
	}

	public void ReassertTopmost()
	{
		if (_hwnd != IntPtr.Zero)
		{
			NativeMethods.SetWindowPos(_hwnd, NativeMethods.HWND_TOPMOST, 0, 0, 0, 0, 19u);
		}
	}

	public void ToggleFullyVisible()
	{
		if (base.IsVisible)
		{
			Hide();
			return;
		}
		Show();
		ReassertTopmost();
	}

	public void ClearToolSelection()
	{
		foreach (object child in ToolsPanel.Children)
		{
			if (child is System.Windows.Controls.Button button)
			{
				button.ClearValue(System.Windows.Controls.Control.BorderBrushProperty);
				button.ClearValue(System.Windows.Controls.Control.BorderThicknessProperty);
			}
		}
		_selectedToolButton = null;
	}

	private void HighlightSelectedTool(System.Windows.Controls.Button selected)
	{
		ClearToolSelection();
		_selectedToolButton = selected;
		selected.SetResourceReference(System.Windows.Controls.Control.BorderBrushProperty, "ActiveBrush");
		selected.BorderThickness = new Thickness((_themeMode == "orbit") ? 1.5 : 1.0);
	}

	public void HighlightPenTool()
	{
		HighlightSelectedTool(BtnPenGroup);
	}

	public void WakeFromCollapsed()
	{
		if (_minimized)
		{
			Expand_Click(this, new RoutedEventArgs());
		}
	}

	private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		DragMove();
	}

	private void MiniBar_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		double left = base.Left;
		double top = base.Top;
		try
		{
			DragMove();
		}
		catch (InvalidOperationException)
		{
		}
		if (!(Math.Abs(base.Left - left) > 3.0) && !(Math.Abs(base.Top - top) > 3.0))
		{
			Expand_Click(sender, e);
		}
	}

	private void Minimize_Click(object sender, RoutedEventArgs e)
	{
		_minimized = true;
		double num = base.Left + base.Width;
		FullBar.Visibility = Visibility.Collapsed;
		MiniBar.Visibility = Visibility.Visible;
		base.Width = 34.0;
		base.Height = 34.0;
		base.Left = num - base.Width;
		_weEnabledClickThrough = false;
		if (!_overlay.IsClickThrough)
		{
			_overlay.ToggleClickThrough();
			_weEnabledClickThrough = true;
		}
	}

	private void Expand_Click(object sender, RoutedEventArgs e)
	{
		_minimized = false;
		double num = base.Left + base.Width;
		MiniBar.Visibility = Visibility.Collapsed;
		FullBar.Visibility = Visibility.Visible;
		base.Width = _fullWidth;
		base.Height = _fullHeight;
		base.Left = num - base.Width;
		if (_weEnabledClickThrough && _overlay.IsClickThrough)
		{
			_overlay.ToggleClickThrough();
		}
		_weEnabledClickThrough = false;
	}

	private void Tool_Click(object sender, RoutedEventArgs e)
	{
		System.Windows.Controls.Button button = (System.Windows.Controls.Button)sender;
		MainWindow overlay = _overlay;
		string name = button.Name;
		Tool currentTool = ((name == "BtnText") ? Tool.Text : ((!(name == "BtnEraser")) ? _overlay.CurrentTool : Tool.Eraser));
		overlay.CurrentTool = currentTool;
		if (_overlay.IsClickThrough)
		{
			_overlay.ToggleClickThrough();
		}
		HighlightSelectedTool(button);
	}

	private void PenGroupButton_Click(object sender, RoutedEventArgs e)
	{
		PenGroupPopup.IsOpen = !PenGroupPopup.IsOpen;
	}

	private void PenGroupOption_Click(object sender, RoutedEventArgs e)
	{
		string text = (string)((System.Windows.Controls.Button)sender).Tag;
		MainWindow overlay = _overlay;
		Tool currentTool = ((!(text == "Pen")) ? ((!(text == "Arrow")) ? _overlay.CurrentTool : Tool.Arrow) : Tool.Pen);
		overlay.CurrentTool = currentTool;
		if (_overlay.IsClickThrough)
		{
			_overlay.ToggleClickThrough();
		}
		HighlightSelectedTool(BtnPenGroup);
		PenGroupPopup.IsOpen = false;
	}

	private void ColorButton_Click(object sender, RoutedEventArgs e)
	{
		ColorPopup.IsOpen = !ColorPopup.IsOpen;
	}

	private void PresetColor_Click(object sender, RoutedEventArgs e)
	{
		System.Windows.Media.Color color = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString((string)((System.Windows.Controls.Button)sender).Tag);
		_overlay.CurrentColor = color;
		UpdateColorButtonFill(color);
		ColorPopup.IsOpen = false;
	}

	private void CustomColor_Click(object sender, RoutedEventArgs e)
	{
		using ColorDialog colorDialog = new ColorDialog
		{
			FullOpen = true
		};
		System.Windows.Media.Color currentColor = _overlay.CurrentColor;
		colorDialog.Color = System.Drawing.Color.FromArgb(currentColor.R, currentColor.G, currentColor.B);
		if (colorDialog.ShowDialog() == System.Windows.Forms.DialogResult.OK)
		{
			System.Drawing.Color color = colorDialog.Color;
			System.Windows.Media.Color color2 = System.Windows.Media.Color.FromRgb(color.R, color.G, color.B);
			_overlay.CurrentColor = color2;
			UpdateColorButtonFill(color2);
		}
		ColorPopup.IsOpen = false;
	}

	private void Eyedropper_Click(object sender, RoutedEventArgs e)
	{
		ColorPopup.IsOpen = false;
		_overlay.StartEyedropper();
	}

	private void OnColorPicked(System.Windows.Media.Color c)
	{
		UpdateColorButtonFill(c);
	}

	private void UpdateColorButtonFill(System.Windows.Media.Color c)
	{
		ColorButtonFill.Fill = new SolidColorBrush(c);
	}

	private void ThicknessButton_Click(object sender, RoutedEventArgs e)
	{
		ThicknessPopup.IsOpen = !ThicknessPopup.IsOpen;
	}

	private void ThicknessOption_Click(object sender, RoutedEventArgs e)
	{
		if (double.TryParse((string)((System.Windows.Controls.Button)sender).Tag, out var result))
		{
			_overlay.CurrentThickness = result;
			UpdateThicknessPreview();
		}
		ThicknessPopup.IsOpen = false;
	}

	private void UpdateThicknessPreview()
	{
		ThicknessPreviewLine.StrokeThickness = Math.Clamp(_overlay.CurrentThickness, 1.0, 10.0);
	}

	private void Undo_Click(object sender, RoutedEventArgs e)
	{
		_overlay.Undo();
	}

	private void Clear_Click(object sender, RoutedEventArgs e)
	{
		_overlay.ClearAll();
	}

	private void BoardButton_Click(object sender, RoutedEventArgs e)
	{
		BoardPopup.IsOpen = !BoardPopup.IsOpen;
	}

	private void BoardOption_Click(object sender, RoutedEventArgs e)
	{
		string text = (string)((System.Windows.Controls.Button)sender).Tag;
		MainWindow.BoardMode boardMode = ((text == "White") ? MainWindow.BoardMode.White : ((text == "Black") ? MainWindow.BoardMode.Black : MainWindow.BoardMode.None));
		MainWindow.BoardMode boardMode2 = boardMode;
		_overlay.SetBoardMode(boardMode2);
		BoardPopup.IsOpen = false;
	}

	private void ScreenshotButton_Click(object sender, RoutedEventArgs e)
	{
		ScreenshotPopup.IsOpen = !ScreenshotPopup.IsOpen;
	}

	private void ScreenshotFull_Click(object sender, RoutedEventArgs e)
	{
		ScreenshotPopup.IsOpen = false;
		_overlay.TakeScreenshot();
	}

	private void ScreenshotRegion_Click(object sender, RoutedEventArgs e)
	{
		ScreenshotPopup.IsOpen = false;
		if (_overlay.IsClickThrough)
		{
			_overlay.ToggleClickThrough();
		}
		_overlay.StartRegionScreenshot();
	}

	private void SettingsButton_Click(object sender, RoutedEventArgs e)
	{
		this.SettingsRequested?.Invoke();
	}

	private void UpdatePauseIcon()
	{
		bool isClickThrough = _overlay.IsClickThrough;
		PauseIcon.Visibility = (isClickThrough ? Visibility.Collapsed : Visibility.Visible);
		PlayIcon.Visibility = ((!isClickThrough) ? Visibility.Collapsed : Visibility.Visible);
	}

	private void PauseExit_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
	{
		BtnPauseExit.CaptureMouse();
		BtnPauseExit.ApplyTemplate();
		_holdStartTime = DateTime.UtcNow;
		_holdTimer?.Stop();
		_holdTimer = new DispatcherTimer
		{
			Interval = TimeSpan.FromMilliseconds(30.0)
		};
		_holdTimer.Tick += HoldTimer_Tick;
		_holdTimer.Start();
	}

	private void HoldTimer_Tick(object? sender, EventArgs e)
	{
		double num = Math.Clamp((DateTime.UtcNow - _holdStartTime).TotalMilliseconds / 800.0, 0.0, 1.0);
		if (BtnPauseExit.Template.FindName("Bd", BtnPauseExit) is Border border)
		{
			System.Windows.Media.Color color = (System.Windows.Media.Color)System.Windows.Media.ColorConverter.ConvertFromString("#E5484D");
			byte r = (byte)Math.Round((double)(int)color.R * num);
			byte g = (byte)Math.Round((double)(int)color.G * num);
			byte b = (byte)Math.Round((double)(int)color.B * num);
			byte a = (byte)Math.Round(255.0 * num);
			border.Background = new SolidColorBrush(System.Windows.Media.Color.FromArgb(a, r, g, b));
		}
		if (num >= 1.0)
		{
			_holdTimer?.Stop();
			_holdTimer = null;
			System.Windows.Application.Current.Shutdown();
		}
	}

	private void PauseExit_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
	{
		BtnPauseExit.ReleaseMouseCapture();
		_holdTimer?.Stop();
		_holdTimer = null;
		if (BtnPauseExit.Template.FindName("Bd", BtnPauseExit) is Border border)
		{
			border.ClearValue(Border.BackgroundProperty);
		}
		Minimize_Click(sender, e);
	}
}
