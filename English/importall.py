import os
import requests
import webbrowser
from bs4 import BeautifulSoup
from deep_translator import GoogleTranslator

# --- KONFIGURACE ---
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
WORDS_FILE = "words.txt"

def get_image_urls(query, limit=5):
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

def main():
    translator = GoogleTranslator(source='en', target='cs')
    
    if not os.path.exists(WORDS_FILE):
        print(f"Soubor {WORDS_FILE} nebyl nalezen.")
        return

    with open(WORDS_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()

    updated_lines = []
    processed_count = 0

    for line in lines:
        clean_line = line.strip()
        
        # Ignorujeme prázdné řádky, uvozovky (kategorie), pomlčky (hotová slova) a lomítka (věty)
        if not clean_line or '"' in clean_line or '/' in clean_line or '-' in clean_line:
            updated_lines.append(line)
            continue

        # Máme cílové slovo (např. "happy" nebo "stand_up")
        word = clean_line
        file_name = word.replace(" ", "_")
        search_word = word.replace("_", " ") # Mezery jsou lepší pro Google Vyhledávání a TTS

        # Kontrola existence MP3
        if os.path.exists(f"{file_name}.mp3"):
            print(f"--- Slovo '{word}' již existuje (soubor {file_name}.mp3 nalezen). Přeskakuji. ---")
            updated_lines.append(line)
            continue

        print(f"\n=== Zpracovávám nové slovo: {word.upper()} ===")
        
        # 1. ZVUK (Automaticky přes Google TTS)
        try:
            tts_url = f"https://translate.google.com/translate_tts?ie=UTF-8&q={search_word}&tl=en&client=tw-ob"
            r_audio = requests.get(tts_url, headers=HEADERS)
            if r_audio.status_code == 200:
                with open(f"{file_name}.mp3", "wb") as f:
                    f.write(r_audio.content)
                print("✓ Zvuk stažen.")
            else:
                print(f"X Chyba u zvuku: HTTP {r_audio.status_code}")
        except Exception as e:
            print(f"X Chyba u zvuku: {e}")

        # 2. OBRÁZEK (Interaktivně)
        img_urls = get_image_urls(search_word)
        if img_urls:
            print("Dostupné obrázky (otevírám náhled v prohlížeči...):")
            webbrowser.open(f"https://www.google.com/search?q={search_word}+clipart&tbm=isch")
            
            for i, url in enumerate(img_urls):
                print(f"[{i+1}] {url[:60]}...")
            
            choice = input("Vyber číslo obrázku (1-5) nebo vlož vlastní URL: ").strip()
            
            try:
                if choice.isdigit() and 1 <= int(choice) <= len(img_urls):
                    selected_url = img_urls[int(choice)-1]
                elif choice:
                    selected_url = choice # Vložena přímá URL
                else:
                    raise ValueError("Prázdný vstup pro obrázek.")

                r_img = requests.get(selected_url, headers=HEADERS)
                if r_img.status_code == 200:
                    with open(f"{file_name}.jpg", "wb") as f:
                        f.write(r_img.content)
                    print("✓ Obrázek uložen.")
                else:
                    print("X Nepodařilo se stáhnout vybraný obrázek.")
            except Exception as e:
                print(f"X Chyba při stahování obrázku: {e}")
        else:
            print("X Žádné obrázky nebyly nalezeny.")

        # 3. PŘEKLAD (Interaktivně)
        try:
            suggestion = translator.translate(search_word).lower()
            print(f"Navržený překlad: {suggestion}")
            final_cz = input(f"Potvrď překlad (Enter) nebo napiš vlastní: ").strip()
            if not final_cz:
                final_cz = suggestion
            
            cz_file_name = final_cz.replace(" ", "_")
            word_pair = f"{file_name}-{cz_file_name}"
            
            # Nahradíme původní čisté slovo novým "spárovaným" formátem
            updated_lines.append(f"{word_pair}\n")
            processed_count += 1
            
            # (Ponecháno z tvého originálu: Vytvoření prázdného souboru .cz)
            with open(f"{word_pair}.cz", "w", encoding="utf-8") as _: pass

        except Exception as e:
            print(f"X Chyba u překladu: {e}")
            updated_lines.append(line) # Při chybě se zachová původní slovo pro další pokus

    # 4. ZÁPIS DO WORDS.TXT (In-place update)
    if processed_count > 0:
        print("\n>>> Aktualizuji words.txt (přepisuji původní slova za kompletní páry)...")
        with open(WORDS_FILE, "w", encoding="utf-8") as f:
            f.writelines(updated_lines)
        print(f"Hotovo! Komplet zpracováno {processed_count} slov.")
    else:
        print("\nŽádná nová slova nevyžadovala zpracování.")

if __name__ == "__main__":
    main()