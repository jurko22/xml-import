const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function importXMLFeed() {
    const xmlUrl = "https://ddzmuxcavpgbzhirzlqt.supabase.co/storage/v1/object/sign/xml/single_product.xml?token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1cmwiOiJ4bWwvc2luZ2xlX3Byb2R1Y3QueG1sIiwiaWF0IjoxNzM5MzU3Mzk0LCJleHAiOjIwNTQ3MTczOTR9.TdY-QRhFMT09cx3i5x4QUOlkzfuJ7IzjCNjbjqFfLbc";
    try {
        const response = await fetch(xmlUrl);
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const xmlContent = await response.text();
        
        const parsedData = await parseStringPromise(xmlContent);
        const items = parsedData.SHOP.SHOPITEM || [];

        const products = items.flatMap((item) => {
            const id = item.$.id;
            const name = item.NAME?.[0] || "Unknown";
            const variants = item.VARIANTS?.[0]?.VARIANT || [];
            
            return variants.map((variant) => {
                const size = variant.PARAMETERS?.[0]?.PARAMETER?.[0]?.VALUE?.[0] || "Unknown";
                const price = parseFloat(variant.PRICE_VAT?.[0] || 0);
                const status = variant.AVAILABILITY_OUT_OF_STOCK?.[0] || "Unknown";

                return { id, name, size, price, status };
                console.log("Načítané produkty z XML:", JSON.stringify(products, null, 2));

            });
        });
        
        if (products.length === 0) {
            console.log("No products found in XML feed.");
            return;
        }
        
        for (const product of products) {
            await supabase.from('products').upsert(product, { onConflict: ['id', 'size'] });
        }
        
        console.log("Feed bol importovaný do Supabase!");
    } catch (error) {
        console.error("Error importing XML feed:", error);
    }
}

importXMLFeed();

