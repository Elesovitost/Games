import os
import re
import sys
from gtts import gTTS

def run():
    print("--- Start skriptu ---")
    file_path = "words.txt"
    
    if not os.path.exists(file_path):
        print(f"CHYBA: Soubor '{file_path}' nebyl nalezen v: {os.getcwd()}")
        return

    print(f"Soubor '{file_path}' nalezen. Čtu obsah...")
    
    try:
        with open(file_path, 'r', encoding='utf-8-sig') as f:
            lines = f.readlines()
    except Exception as e:
        print(f"CHYBA při čtení souboru: {e}")
        return

    is_sentences_section = False
    count = 0

    for i, line in enumerate(lines):
        # Odstranění bílých znaků a převod na malá písmena pro kontrolu
        clean_line = line.strip()
        
        if not is_sentences_section:
            # Hledáme "sentences" kdekoli na řádku (robustnější než přesná shoda)
            if "sentences" in clean_line.lower():
                is_sentences_section = True
                print(f"Řádek {i+1}: Nalezena sekce 'sentences'.")
                continue
        
        if is_sentences_section and "/" in clean_line:
            english_part = clean_line.split("/")[0].strip()
            if not english_part:
                continue

            # Čištění názvu souboru
            safe_name = re.sub(r'[^\w\s-]', '', english_part).replace(" ", "_")
            file_name = f"sentence-{safe_name}.mp3"

            if os.path.exists(file_name):
                print(f"  - {file_name} již existuje.")
            else:
                print(f"  - Stahuji: {file_name}")
                try:
                    tts = gTTS(text=english_part, lang='en')
                    tts.save(file_name)
                    count += 1
                except Exception as e:
                    print(f"  - CHYBA při stahování: {e}")

    print(f"--- Hotovo. Staženo nových souborů: {count} ---")

if __name__ == "__main__":
    run()