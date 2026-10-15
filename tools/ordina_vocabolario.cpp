#include "../core/ordinamento_rimario.hpp"

#include <fstream>
#include <iostream>
#include <string>

int main(int argc, char* argv[]) {
    if (argc != 3) {
        std::cerr << "Uso: ordina_vocabolario <input> <output>\n";
        return 2;
    }

    std::ifstream input(argv[1], std::ios::binary);
    if (!input) {
        std::cerr << "Impossibile aprire il file di input: " << argv[1] << '\n';
        return 1;
    }

    anagrammi::Words parole;
    std::string riga;
    while (std::getline(input, riga)) {
        if (!riga.empty() && riga.back() == '\r') {
            riga.pop_back();
        }
        if (!riga.empty()) {
            parole.push_back(std::move(riga));
        }
    }
    if (!input.eof()) {
        std::cerr << "Errore durante la lettura del file di input.\n";
        return 1;
    }

    anagrammi::ordina_rimario(parole);

    std::ofstream output(argv[2], std::ios::binary | std::ios::trunc);
    if (!output) {
        std::cerr << "Impossibile aprire il file di output: " << argv[2] << '\n';
        return 1;
    }
    for (const auto& parola : parole) {
        output << parola << '\n';
    }
    if (!output) {
        std::cerr << "Errore durante la scrittura del file di output.\n";
        return 1;
    }

    std::cout << "Ordinate " << parole.size() << " forme.\n";
    return 0;
}
