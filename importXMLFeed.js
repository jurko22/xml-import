const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function importXMLFeed() {
    const xmlUrl = "https://raw.githubusercontent.com/jurko22/xml-feed/main/feed.xml";
    
    try {
        const response = await fetch(xmlUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const xmlContent = await response.text();
        
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

const products = items.flatMap((item) => {
    const id = item.$.id ? parseInt(item.$.id, 10) : null; 
    const name = item.NAME?.[0] || "Unknown";
    const imageUrl = item.IMAGES?.[0]?.IMAGE?.[0] || null; // Prvý obrázok

    const variants = item.VARIANTS?.[0]?.VARIANT || [];
    
    return variants.map((variant) => {
        const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
        const price = parseFloat(variant.PRICE_VAT?.[0] || 0);
        const status = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Neznámy";

        return { 
            id,
            name, 
            size, 
            price, 
            status, 
            image_url: imageUrl // Pridanie URL obrázka do objektu
        };
    });
});


        console.log("Načítané produkty z XML:", JSON.stringify(products, null, 2));

        if (products.length === 0) {
            console.log("No products found in XML feed.");
            return;
        }

        for (const product of products) {
            if (product.id === null) {
                console.warn(`⚠️ Preskakujem produkt bez platného ID: ${product.name} (${product.size})`);
                continue;
            }

            // Najprv skontrolujeme, či produkt existuje
            const { data: existingProduct, error: selectError } = await supabase
                .from('products')
                .select('id, price, status')
                .eq('id', product.id)
                .eq('size', product.size)
                .single();

            if (selectError && selectError.code !== 'PGRST116') { // PGRST116 = No rows found
                console.error("Chyba pri získavaní produktu:", selectError);
                continue;
            }

            if (existingProduct) {
                // Produkt existuje → aktualizujeme len cenu a status, ak sa zmenili
                if (existingProduct.price !== product.price || existingProduct.status !== product.status) {
                    console.log(`🔄 Aktualizujem produkt: ${product.name} (${product.size})`);
                    const { error: updateError } = await supabase
                        .from('products')
                        .update({
                            price: product.price,
                            status: product.status
                        })
                        .eq('id', existingProduct.id)
                        .eq('size', product.size);

                    if (updateError) {
                        console.error("Chyba pri aktualizácii produktu:", updateError);
                    } else {
                        console.log("✅ Produkt aktualizovaný:", product);
                    }
                } else {
                    console.log(`✅ Produkt ${product.name} (${product.size}) je už aktuálny.`);
                }
            } else {
                // Produkt neexistuje → pridáme ho
                console.log(`➕ Pridávam nový produkt: ${product.name} (${product.size})`);
                const { error: insertError } = await supabase
                    .from('products')
                    .insert(product);

                if (insertError) {
                    console.error("Chyba pri vkladaní nového produktu:", insertError);
                } else {
                    console.log("✅ Nový produkt zapísaný:", product);
                }
            }
        }

        console.log("Feed bol importovaný do Supabase!");
    } catch (error) {
        console.error("Error importing XML feed:", error);
    }
}

importXMLFeed();

