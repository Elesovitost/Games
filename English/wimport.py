import os
import pathlib
import re
import urllib.request
import webbrowser
import requests
from bs4 import BeautifulSoup

try:
    from gtts import gTTS
except ImportError:
    print("Některé knihovny chybí. Nainstaluj je: pip install requests beautifulsoup4 gTTS")
    exit(1)

# --- KONFIGURACE ---
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
WORDS_FILE = "words.txt"

def get_image_urls(query, limit=5):
    """Najde URL obrázků přes Google Search."""
    search_url = f"https://www.google.com/search?q={query}+clipart&tbm=isch"
    try:
        r = requests.get(search_url, headers=HEADERS)
        soup = BeautifulSoup(r.text, 'html.parser')
        img_tags = soup.find_all("img")
        
        urls = []
        for img in img_tags[1:]:
            src = img.get("src")
            if src and src.startswith("http"):
                urls.append(src)
            if len(urls) >= limit:
                break
        return urls
    except Exception as e:
        print(f"Chyba při hledání obrázků: {e}")
        return []

def sanitize_filename(text):
    """Odstraní nepovolené znaky pro bezpečný název souboru."""
    return re.sub(r'[^\w\s]', '', text).strip().replace(' ', '_')

def process_vocabulary():
    base_path = pathlib.Path(".")
    words_file = base_path / WORDS_FILE
    
    if not words_file.exists():
        print(f"Chyba: Soubor {WORDS_FILE} nebyl nalezen.")
        return

    with open(words_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    for line in lines:
        line = line.strip()
        
        # Ignorování metadat a prázdných řádků
        if not line or line.startswith('"') or re.search(r'\*[^*]+\*', line):
            continue

        # ZPRACOVÁNÍ VĚT (detekce pomocí lomítka)
        if '/' in line:
            parts = line.split('/')
            if len(parts) >= 2:
                en_sentence = parts[0].strip()
                cs_sentence = parts[1].strip()

                safe_en = sanitize_filename(en_sentence)
                safe_cs = sanitize_filename(cs_sentence)

                en_mp3_path = base_path / f"sentence-{safe_en}.mp3"
                cs_mp3_path = base_path / f"věta-{safe_cs}.mp3"

                # EN Audio
                if not en_mp3_path.exists():
                    print(f"[VĚTA EN] Generuji MP3: {en_mp3_path.name}")
                    gTTS(en_sentence, lang='en').save(en_mp3_path)

                # CS Audio
                if not cs_mp3_path.exists():
                    print(f"[VĚTA CS] Generuji MP3: {cs_mp3_path.name}")
                    gTTS(cs_sentence, lang='cs').save(cs_mp3_path)

        # ZPRACOVÁNÍ SLOV (detekce pomocí pomlčky)
        elif '-' in line:
            parts = line.split('-')
            if len(parts) >= 2:
                en_word_raw = parts[0].strip().lower()
                cs_word_raw = parts[1].strip().lower()
                
                en_word_clean = en_word_raw.replace("_", " ")
                cs_word_clean = cs_word_raw.replace("_", " ")

                en_mp3_path = base_path / f"{en_word_raw}.mp3"
                cs_mp3_path = base_path / f"{cs_word_raw}.mp3"
                img_path = base_path / f"{en_word_raw}.jpg"

                # EN Audio
                if not en_mp3_path.exists():
                    print(f"[SLOVO EN] Generuji MP3: {en_mp3_path.name}")
                    gTTS(en_word_clean, lang='en').save(en_mp3_path)

                # CS Audio
                if not cs_mp3_path.exists() and cs_word_clean:
                    print(f"[SLOVO CS] Generuji MP3: {cs_mp3_path.name}")
                    gTTS(cs_word_clean, lang='cs').save(cs_mp3_path)

                # Obrázek (interaktivní stažení)
                if not img_path.exists():
                    print(f"\n[OBRÁZEK] Chybí obrázek pro: {en_word_raw.upper()}")
                    img_urls = get_image_urls(en_word_clean)
                    
                    if img_urls:
                        print("Otevírám náhled v prohlížeči...")
                        webbrowser.open(f"https://www.google.com/search?q={urllib.parse.quote(en_word_clean)}+clipart&tbm=isch")
                        
                        for i, url in enumerate(img_urls):
                            print(f"[{i+1}] {url[:60]}...")
                        
                        choice = input("Vyber číslo obrázku (1-5) nebo vlož vlastní URL (0 = přeskočit): ").strip()
                        
                        try:
                            selected_url = None
                            if choice.isdigit() and 1 <= int(choice) <= len(img_urls):
                                selected_url = img_urls[int(choice)-1]
                            elif choice and choice != '0':
                                selected_url = choice
                            
                            if selected_url:
                                r_img = requests.get(selected_url, headers=HEADERS)
                                if r_img.status_code == 200:
                                    with open(img_path, "wb") as img_file:
                                        img_file.write(r_img.content)
                                    print(f"✓ Obrázek uložen jako {img_path.name}.")
                                else:
                                    print("X HTTP chyba při stahování vybraného obrázku.")
                        except Exception as e:
                            print(f"X Chyba při ukládání obrázku: {e}")
                    else:
                        print("X Žádné obrázky nebyly přes Google nalezeny.")

    print("-" * 30)
    print("Zpracování dokončeno. Soubor words.txt zůstal nezměněn.")

if __name__ == "__main__":
    process_vocabulary()