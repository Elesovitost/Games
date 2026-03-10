import os
import pathlib
import re
import urllib.request
import webbrowser
import requests
from bs4 import BeautifulSoup

try:
    from gtts import gTTS
    from deep_translator import GoogleTranslator
except ImportError:
    print("Některé knihovny chybí. Nainstaluj je: pip install requests beautifulsoup4 deep-translator gTTS")
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

def process_vocabulary():
    base_path = pathlib.Path(".")
    words_file = base_path / WORDS_FILE
    translator = GoogleTranslator(source='en', target='cs')
    
    if not words_file.exists():
        print(f"Chyba: Soubor {WORDS_FILE} nebyl nalezen.")
        return

    with open(words_file, "r", encoding="utf-8") as f:
        lines = f.readlines()

    new_words = []
    new_sentences = []
    retained_lines = []

    for line in lines:
        original_line = line
        line = line.strip()
        
        if not line:
            retained_lines.append(original_line)
            continue

        if line.startswith('"'):
            # Ignorujeme existující hlavičky NEW (a staré NEW SENTENCES pro zpětnou kompatibilitu)
            if line.upper() in ['"NEW"', '"NEW SENTENCES"']:
                continue
            retained_lines.append(original_line)
            continue

        # Detekce věty na základě lomítka
        if '/' in line:
            # Zpracování vět
            en_sentence = line.split('/')[0].strip()
            safe_name = re.sub(r'[^\w\s]', '', en_sentence).strip().replace(' ', '_')
            mp3_path = base_path / f"sentence-{safe_name}.mp3"

            if not mp3_path.exists():
                print(f"\n[VĚTA] Generuji MP3: {mp3_path.name}")
                gTTS(en_sentence, lang='en').save(mp3_path)
                new_sentences.append(original_line.strip())
            else:
                retained_lines.append(original_line)
        else:
            # Zpracování slov
            parts = line.split('-')
            en_word = parts[0].strip().lower()
            search_word = en_word.replace("_", " ")
            mp3_path = base_path / f"{en_word}.mp3"

            if not mp3_path.exists():
                print(f"\n=== Zpracovávám nové slovo: {en_word.upper()} ===")
                
                # 1. Generování Zvuku
                gTTS(search_word, lang='en').save(mp3_path)
                print(f"✓ MP3 vytvořeno: {mp3_path.name}")
                
                # 2. Obrázek (Interaktivně)
                img_urls = get_image_urls(search_word)
                if img_urls:
                    print("Dostupné obrázky (otevírám náhled v prohlížeči...):")
                    webbrowser.open(f"https://www.google.com/search?q={search_word}+clipart&tbm=isch")
                    
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
                                with open(base_path / f"{en_word}.jpg", "wb") as img_file:
                                    img_file.write(r_img.content)
                                print("✓ Obrázek uložen.")
                            else:
                                print("X Nepodařilo se stáhnout vybraný obrázek.")
                    except Exception as e:
                        print(f"X Chyba při stahování obrázku: {e}")
                else:
                    print("X Žádné obrázky nebyly nalezeny.")

                # 3. Překlad (Interaktivně)
                try:
                    suggestion = translator.translate(search_word).lower()
                    print(f"Navržený překlad: {suggestion}")
                    final_cz = input(f"Potvrď překlad (Enter) nebo napiš vlastní: ").strip()
                    if not final_cz:
                        final_cz = suggestion
                    
                    cz_formatted = final_cz.replace(" ", "_")
                    word_pair = f"{en_word}-{cz_formatted}"
                    
                    new_words.append(word_pair)
                except Exception as e:
                    print(f"X Chyba u překladu: {e}")
                    new_words.append(f"{en_word}-") # Fallback v případě chyby sítě
            else:
                retained_lines.append(original_line)

    # 4. Přepis souboru s novou strukturou
    with open(words_file, "w", encoding="utf-8") as f:
        # Nová slova zcela nahoře
        if new_words:
            f.write('"NEW"\n')
            for w in new_words:
                f.write(f"{w}\n")
            f.write("\n")
            
        # Původní obsah (již bez zpracovaných nových slov/vět a s pročištěnými starými tagy)
        for line in retained_lines:
            f.write(line)
            
        # Nové věty zcela dole na konec "sentences"
        if new_sentences:
            for s in new_sentences:
                f.write(f"{s}\n")

    print("-" * 30)
    print(f"Dokončeno. Přidáno slov nahoru: {len(new_words)}. Přidáno vět dolů na konec: {len(new_sentences)}.")

if __name__ == "__main__":
    process_vocabulary()