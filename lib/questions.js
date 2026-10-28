const questions = [
 {id:'q1',fault:'engine',text:'Two fair dice are rolled. What is the probability that their total is 8?',options:['1/6','5/36','1/9','7/36'],answer:1,difficulty:'medium'},
 {id:'q2',fault:'brake',text:'What does this C code print? int a[]={2,4,6,8}; int s=0; for(int i=0;i<4;i+=2) s+=a[i]; printf("%d",s);',options:['8','10','12','20'],answer:0,difficulty:'medium'},
 {id:'q3',fault:'fuel',text:'A car uses 5.5 L per 100 km. About how much fuel will it use over 720 km?',options:['36.6 L','39.6 L','41.2 L','45 L'],answer:1,difficulty:'medium'},
 {id:'q4',fault:'temperature',text:'A car’s temperature is 92°C and falls by 6°C each minute. What is it after 7 minutes at that rate?',options:['44°C','48°C','50°C','56°C'],answer:2,difficulty:'medium'},
 {id:'q5',fault:'speed',text:'A 180 m train passes a pole in 12 seconds. What is its speed in km/h?',options:['45','54','60','72'],answer:1,difficulty:'medium'},
 {id:'q6',fault:'engine',text:'Find the next number: 3, 8, 18, 38, __',options:['58','68','76','78'],answer:3,difficulty:'medium'},
 {id:'q7',fault:'brake',text:'What does this Python code print? values=[1,2,3,4,5]; print(values[1::2])',options:['[1, 3, 5]','[2, 4]','[2, 3, 4]','[1, 2]'],answer:1,difficulty:'medium'},
 {id:'q8',fault:'fuel',text:'A vehicle travels 150 km using 12 L. At the same rate, how far can it travel with 25 L?',options:['300 km','312.5 km','325 km','337.5 km'],answer:1,difficulty:'medium'},
 {id:'q9',fault:'temperature',text:'Four temperature readings average 75°C. Three are 70°C, 72°C, and 78°C. What is the fourth?',options:['78°C','80°C','82°C','84°C'],answer:1,difficulty:'medium'},
 {id:'q10',fault:'speed',text:'A trip lasts 2 hours: the first hour is driven at 40 km/h and the second at 60 km/h. How far was travelled in total?',options:['90 km','100 km','110 km','120 km'],answer:1,difficulty:'medium'},
 {id:'q11',fault:'engine',text:'What does this C code print? int x=29; x/=4; printf("%d",x);',options:['6','7','7.25','8'],answer:1,difficulty:'medium'},
 {id:'q12',fault:'brake',text:'A sorted list has 64 items. In the worst case, how many comparisons does binary search need?',options:['6','7','32','64'],answer:1,difficulty:'medium'},
 {id:'q13',fault:'fuel',text:'A 25 L mixture uses a fuel-to-additive ratio of 3:2. How many litres are fuel?',options:['10 L','12.5 L','15 L','18 L'],answer:2,difficulty:'medium'},
 {id:'q14',fault:'temperature',text:'A sensor rises from 68°C to 86°C over 6 minutes. What is the average increase per minute?',options:['2°C','3°C','4°C','6°C'],answer:1,difficulty:'medium'},
 {id:'q15',fault:'speed',text:'How many times does this C loop run? for (int i=1; i<10; i+=3)',options:['2','3','4','5'],answer:1,difficulty:'medium'}
];

module.exports = { questions, faultTypes: ['engine','brake','fuel','temperature','speed'] };
