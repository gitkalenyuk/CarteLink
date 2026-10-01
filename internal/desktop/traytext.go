package desktop

// Tray/notification texts per UI language (the web UI has its own
// translations in internal/web/ui/i18n; these are the few strings Windows
// itself shows).
var trayTexts = map[string]map[string]string{
	"uk": {
		"open":     "Відкрити CarteLink",
		"switcher": "Перемикач моделей поверх вікон",
		"quit":     "Вийти",
		"tip":      "CarteLink — AI-шлюз працює",
		"bgTitle":  "CarteLink працює у фоні",
		"bgText":   "Шлюз далі працює. Відкрити вікно — клік по значку в треї; вийти — правий клік → «Вийти».",
	},
	"en": {
		"open":     "Open CarteLink",
		"switcher": "Always-on-top model switcher",
		"quit":     "Quit",
		"tip":      "CarteLink — AI gateway is running",
		"bgTitle":  "CarteLink is running in the background",
		"bgText":   "The gateway keeps running. To open the window, click the tray icon; to exit, right-click → “Quit”.",
	},
	"zh": {
		"open":     "打开 CarteLink",
		"switcher": "置顶模型切换器",
		"quit":     "退出",
		"tip":      "CarteLink — AI 网关运行中",
		"bgTitle":  "CarteLink 正在后台运行",
		"bgText":   "网关仍在运行。打开窗口 — 单击托盘图标；退出 — 右键单击 → “退出”。",
	},
	"hi": {
		"open":     "CarteLink खोलें",
		"switcher": "सभी विंडो के ऊपर मॉडल स्विचर",
		"quit":     "बाहर निकलें",
		"tip":      "CarteLink — AI गेटवे चल रहा है",
		"bgTitle":  "CarteLink बैकग्राउंड में चल रहा है",
		"bgText":   "गेटवे चलता रहता है। विंडो खोलने के लिए ट्रे आइकन पर क्लिक करें; बाहर निकलने के लिए राइट-क्लिक → “बाहर निकलें”।",
	},
	"es": {
		"open":     "Abrir CarteLink",
		"switcher": "Selector de modelos siempre visible",
		"quit":     "Salir",
		"tip":      "CarteLink: el gateway de IA está en marcha",
		"bgTitle":  "CarteLink sigue en segundo plano",
		"bgText":   "El gateway sigue funcionando. Para abrir la ventana, haz clic en el icono de la bandeja del sistema; para salir, clic derecho → «Salir».",
	},
	"fr": {
		"open":     "Ouvrir CarteLink",
		"switcher": "Sélecteur de modèles au premier plan",
		"quit":     "Quitter",
		"tip":      "CarteLink — passerelle IA en marche",
		"bgTitle":  "CarteLink fonctionne en arrière-plan",
		"bgText":   "La passerelle continue de fonctionner. Ouvrir la fenêtre : clic sur l'icône de la zone de notification ; quitter : clic droit → « Quitter ».",
	},
	"ar": {
		"open":     "فتح CarteLink",
		"switcher": "مبدّل النماذج فوق النوافذ",
		"quit":     "خروج",
		"tip":      "CarteLink — بوابة AI تعمل",
		"bgTitle":  "CarteLink يعمل في الخلفية",
		"bgText":   "تستمر البوابة في العمل. لفتح النافذة — انقر على الأيقونة في شريط النظام؛ للخروج — نقرة يمنى ← «خروج».",
	},
	"bn": {
		"open":     "CarteLink খুলুন",
		"switcher": "সব উইন্ডোর উপরে মডেল সুইচার",
		"quit":     "প্রস্থান",
		"tip":      "CarteLink — AI গেটওয়ে চলছে",
		"bgTitle":  "CarteLink ব্যাকগ্রাউন্ডে চলছে",
		"bgText":   "গেটওয়ে চলতে থাকবে। উইন্ডো খুলতে — ট্রেতে আইকনে ক্লিক করুন; প্রস্থান করতে — রাইট-ক্লিক → “প্রস্থান”।",
	},
	"pt": {
		"open":     "Abrir o CarteLink",
		"switcher": "Seletor de modelos sobre as janelas",
		"quit":     "Sair",
		"tip":      "CarteLink — gateway de IA em execução",
		"bgTitle":  "O CarteLink está rodando em segundo plano",
		"bgText":   "O gateway continua funcionando. Para abrir a janela, clique no ícone na bandeja; para sair, clique direito → “Sair”.",
	},
	"ur": {
		"open":     "CarteLink کھولیں",
		"switcher": "تمام ونڈوز کے اوپر ماڈل سوئچر",
		"quit":     "باہر نکلیں",
		"tip":      "CarteLink — AI گیٹ وے چل رہا ہے",
		"bgTitle":  "CarteLink پس منظر میں چل رہا ہے",
		"bgText":   "گیٹ وے چلتا رہتا ہے۔ ونڈو کھولنے کے لیے سسٹم ٹرے کے آئیکن پر کلک کریں؛ باہر نکلنے کے لیے رائٹ کلک ← “باہر نکلیں”۔",
	},
	"id": {
		"open":     "Buka CarteLink",
		"switcher": "Pengalih model di atas jendela",
		"quit":     "Keluar",
		"tip":      "CarteLink — gateway AI berjalan",
		"bgTitle":  "CarteLink berjalan di latar belakang",
		"bgText":   "Gateway tetap berjalan. Buka jendela — klik ikon di baki sistem; keluar — klik kanan → “Keluar”.",
	},
	"de": {
		"open":     "CarteLink öffnen",
		"switcher": "Modell-Umschalter über allen Fenstern",
		"quit":     "Beenden",
		"tip":      "CarteLink – AI-Gateway läuft",
		"bgTitle":  "CarteLink läuft im Hintergrund",
		"bgText":   "Das Gateway läuft weiter. Fenster öffnen – Klick auf das Symbol im Infobereich; beenden – Rechtsklick → „Beenden“.",
	},
	"ja": {
		"open":     "CarteLink を開く",
		"switcher": "最前面のモデルスイッチャー",
		"quit":     "終了",
		"tip":      "CarteLink — AI ゲートウェイ動作中",
		"bgTitle":  "CarteLink はバックグラウンドで動作中です",
		"bgText":   "ゲートウェイは動作を続けています。ウィンドウを開くにはトレイのアイコンをクリック、終了するには右クリック →「終了」。",
	},
	"tr": {
		"open":     "CarteLink'i aç",
		"switcher": "Pencerelerin üstünde model değiştirici",
		"quit":     "Çıkış",
		"tip":      "CarteLink — AI ağ geçidi çalışıyor",
		"bgTitle":  "CarteLink arka planda çalışıyor",
		"bgText":   "Ağ geçidi çalışmaya devam ediyor. Pencereyi açmak için tepsideki simgeye tıkla; çıkmak için sağ tık → \"Çıkış\".",
	},
	"ko": {
		"open":     "CarteLink 열기",
		"switcher": "항상 위에 표시되는 모델 전환기",
		"quit":     "종료",
		"tip":      "CarteLink — AI 게이트웨이 작동 중",
		"bgTitle":  "CarteLink가 백그라운드에서 실행 중입니다",
		"bgText":   "게이트웨이는 계속 작동합니다. 창을 열려면 트레이 아이콘을 클릭하고, 종료하려면 우클릭 → ‘종료’를 선택하세요.",
	},
	"vi": {
		"open":     "Mở CarteLink",
		"switcher": "Bộ chuyển mô hình nổi trên cửa sổ",
		"quit":     "Thoát",
		"tip":      "CarteLink — cổng AI đang chạy",
		"bgTitle":  "CarteLink đang chạy nền",
		"bgText":   "Cổng vẫn tiếp tục chạy. Mở cửa sổ — nhấp vào biểu tượng trong khay hệ thống; thoát — nhấp chuột phải → “Thoát”.",
	},
	"pl": {
		"open":     "Otwórz CarteLink",
		"switcher": "Przełącznik modeli na wierzchu",
		"quit":     "Zakończ",
		"tip":      "CarteLink — bramka AI działa",
		"bgTitle":  "CarteLink działa w tle",
		"bgText":   "Bramka dalej działa. Otwórz okno — kliknij ikonę w zasobniku systemowym; zakończ — prawy klik → „Zakończ”.",
	},
}

// trayTextFor returns the text for key in lang, falling back to English for
// other languages and to Ukrainian when the key is missing.
func trayTextFor(lang, key string) string {
	if lang == "" {
		lang = "uk"
	}
	if m, ok := trayTexts[lang]; ok {
		if s, ok := m[key]; ok {
			return s
		}
	}
	if s, ok := trayTexts["en"][key]; ok && lang != "uk" {
		return s
	}
	return trayTexts["uk"][key]
}
